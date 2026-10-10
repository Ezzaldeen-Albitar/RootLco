/**
 * P1-32-PRE-OD-FD1 — money rounded to the currency's minor unit (ADR-023, D1;
 * migration 20260930100000_sal_minor_unit_rounding.sql).
 *
 * The Owner's rule: a monetary LINE amount is rounded half-up to the currency's
 * minor unit where it is computed, document totals are sums of rounded lines,
 * quantities / rates / unit prices keep their own scales, and an issued
 * document keeps its stored snapshot. Each case below fails if the part of the
 * migration it names is removed: the helper's rounding, the quotation-line
 * trigger that replaced the two four-decimal CHECKs, the re-issued
 * quo.issue_revision (sums of rounded lines; a sub-minor-unit draft refused), and
 * the trigger's "no money column changed" early exit that keeps a stored line
 * from ever being re-validated. Two cases hold the issued snapshots: a revision
 * issued under the four-decimal rule (fractional quantity, four-decimal unit
 * price) keeps every captured figure and reconciles under the re-issued
 * quo.guard_revision_totals, and an issued four-decimal invoice keeps its
 * figures and its exact outstanding balance.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { expectFail, seedService } from './p1-10-helpers';
import { P9, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import {
  addInvoiceLine,
  issueInvoice,
  makeWorkOrder,
  seedDraftInvoice,
  seedP111Base,
} from './p1-11-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

type Q = { query: Client['query'] };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  // The P1-11 base is the P1-09 base plus the invoice numbering and permissions
  // the issued-invoice case below needs.
  await seedP111Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

async function text(c: Q, sql: string, params: unknown[] = []): Promise<string> {
  const { rows } = await c.query(sql, params);
  return String(rows[0]?.v);
}

/** A draft JOD (or USD) revision, on a fresh work order unless one is named. */
async function draft(
  c: Q,
  tag: string,
  currency: 'JOD' | 'USD',
  onWorkOrder?: string
): Promise<string> {
  const workOrder = onWorkOrder ?? (await newWorkOrder(c, await makeAuthorizedVisit(c)));
  const quotation = (
    await c.query(
      `INSERT INTO quo.quotations (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, workOrder, `Q-${tag}`, currency, USER_A]
    )
  ).rows[0].id as string;
  return (
    await c.query(
      `INSERT INTO quo.quotation_revisions (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, currency, USER_A]
    )
  ).rows[0].id as string;
}

const INSERT_ITEM = `INSERT INTO quo.quotation_items
   (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, service_id,
    currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
    captured_tax_amount, captured_line_total, created_by)
 VALUES ($1,$2,$3,$4,$5,'service',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`;

/** One line with EXPLICIT amounts, so a test can offer the trigger a wrong one. */
async function item(
  c: Q,
  revision: string,
  service: string,
  line: number,
  currency: string,
  money: { unit: string; qty: string; discount?: string; rate: string; tax: string; total: string }
): Promise<string> {
  return (
    await c.query(INSERT_ITEM, [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      revision,
      line,
      service,
      currency,
      money.unit,
      money.qty,
      money.discount ?? '0',
      money.rate,
      money.tax,
      money.total,
      USER_A,
    ])
  ).rows[0].id as string;
}

describe('D1 — the rounding rule', () => {
  it('rounds half-up to the minor unit the currency register records, and only there', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // The review's example: round(12.345 x 0.16, 4) = 1.9752, a residue no JOD
      // receipt can settle. At JOD's three decimals it is 1.975.
      expect(
        await text(c, `SELECT shared.round_to_minor_unit(12.345 * 0.16, 'JOD')::text AS v`)
      ).toBe('1.975');
      // Half-up, exactly: 2.675 is not a binary fraction here.
      expect(await text(c, `SELECT shared.round_to_minor_unit(2.675, 'USD')::text AS v`)).toBe(
        '2.68'
      );
      expect(
        await text(c, `SELECT shared.round_to_minor_unit(10.99 * 0.16, 'USD')::text AS v`)
      ).toBe('1.76');
      expect(await text(c, `SELECT shared.fits_minor_unit(12.3450, 'JOD')::text AS v`)).toBe(
        'true'
      );
      expect(await text(c, `SELECT shared.fits_minor_unit(1.9752, 'JOD')::text AS v`)).toBe(
        'false'
      );
      await expectFail(c, '23503', `SELECT shared.round_to_minor_unit(1, 'XXX')`);
    });
  });
});

describe('D1 — quotation lines at the minor unit', () => {
  it('accepts the JOD 16% line at 1.975 tax and 14.320 gross, and refuses the 4-decimal residue', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd1_jod');
      const rev = await draft(c, 'fd1_jod', 'JOD');
      // The ck_quotation_items_tax_amount figure is refused now…
      await expectFail(c, '23514', INSERT_ITEM, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        rev,
        1,
        service,
        'JOD',
        '12.3450',
        '1.000',
        '0',
        '0.160000',
        '1.9752',
        '14.3202',
        USER_A,
      ]);
      // …and the minor-unit figure is the one accepted.
      await item(c, rev, service, 1, 'JOD', {
        unit: '12.3450',
        qty: '1.000',
        rate: '0.160000',
        tax: '1.9750',
        total: '14.3200',
      });
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      // The deferred totals identity (tg_quotation_items_totals) runs now, not at a
      // COMMIT this rolled-back transaction never reaches.
      await c.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      const totals = (
        await c.query(
          `SELECT captured_subtotal::text AS sub, captured_discount_total::text AS disc,
                  captured_tax_total::text AS tax, captured_grand_total::text AS grand
             FROM quo.quotation_revisions WHERE id = $1`,
          [rev]
        )
      ).rows[0];
      expect(totals).toEqual({ sub: '12.3450', disc: '0.0000', tax: '1.9750', grand: '14.3200' });
    });
  });

  it('keeps quantities, rates and unit prices at their own scales; only amounts take the currency’s', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd1_scales');
      const rev = await draft(c, 'fd1_scales', 'USD');
      // A 1.5 quantity, a 16.5% rate and a four-decimal UNIT price are accepted;
      // the line net 1.2345 x 1.5 = 1.85175 is rounded to 1.85, its tax
      // 1.85 x 0.165 = 0.30525 to 0.31, and the total is their sum, 2.16.
      await item(c, rev, service, 1, 'USD', {
        unit: '1.2345',
        qty: '1.500',
        rate: '0.165000',
        tax: '0.3100',
        total: '2.1600',
      });
      // A fixed discount is an amount of money: 0.005 is finer than a cent.
      await expectFail(c, '23514', INSERT_ITEM, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        rev,
        2,
        service,
        'USD',
        '10.0000',
        '1.000',
        '0.0050',
        '0',
        '0',
        '9.9950',
        USER_A,
      ]);
      // A line total that is not net + tax is refused whatever its precision.
      await expectFail(c, '23514', INSERT_ITEM, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        rev,
        2,
        service,
        'USD',
        '10.0000',
        '1.000',
        '1.0000',
        '0.100000',
        '0.9000',
        '10.0000',
        USER_A,
      ]);
      // A whole-cent discount is accepted, with the tax on the discounted net. (On
      // a draft of its own: issuing a discount needs an approval, which is not what
      // this case is about.)
      const workOrder = await c.query(
        `SELECT q.work_order_id AS v FROM quo.quotation_revisions r
           JOIN quo.quotations q ON q.id = r.quotation_id WHERE r.id = $1`,
        [rev]
      );
      const discounted = await draft(c, 'fd1_scales_disc', 'USD', workOrder.rows[0].v);
      await item(c, discounted, service, 1, 'USD', {
        unit: '10.0000',
        qty: '1.000',
        discount: '1.0000',
        rate: '0.100000',
        tax: '0.9000',
        total: '9.9000',
      });
      await item(c, rev, service, 2, 'USD', {
        unit: '10.0000',
        qty: '1.000',
        rate: '0.100000',
        tax: '1.0000',
        total: '11.0000',
      });
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      // The deferred totals identity checks the issued revision against the same
      // sums, here rather than at a COMMIT this transaction never reaches.
      await c.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      // Document totals are sums of rounded lines, and reconcile by construction:
      // subtotal - discount + tax = grand, and grand = the sum of line totals.
      const r = (
        await c.query(
          `SELECT captured_subtotal::text AS sub, captured_discount_total::text AS disc,
                  captured_tax_total::text AS tax, captured_grand_total::text AS grand,
                  (SELECT sum(captured_line_total)::text FROM quo.quotation_items
                    WHERE quotation_revision_id = $1) AS line_sum
             FROM quo.quotation_revisions WHERE id = $1`,
          [rev]
        )
      ).rows[0];
      expect(r).toEqual({
        sub: '11.8500',
        disc: '0.0000',
        tax: '1.3100',
        grand: '13.1600',
        line_sum: '13.1600',
      });
    });
  });
});

describe('D1 — stored figures are never recomputed', () => {
  it('leaves a line written before the rule untouched, and refuses to ISSUE a draft that carries one', async () => {
    // A line with the old four-decimal residue can exist only from before the
    // migration. It is written here with ordinary triggers suspended, as the
    // migration found it; then the triggers are back for everything that follows.
    await withRolledBackTx(admin, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd1_legacy');
      const rev = await draft(c, 'fd1_legacy', 'JOD');
      await c.query(`SET LOCAL session_replication_role = replica`);
      const legacy = await item(c, rev, service, 1, 'JOD', {
        unit: '12.3450',
        qty: '1.000',
        rate: '0.160000',
        tax: '1.9752',
        total: '14.3202',
      });
      await c.query(`SET LOCAL session_replication_role = origin`);

      // An UPDATE that changes no money column is not re-validated, and nothing
      // is rewritten: the stored figures are exactly what was stored.
      await c.query(`UPDATE quo.quotation_items SET description = 'Relabelled' WHERE id = $1`, [
        legacy,
      ]);
      const stored = (
        await c.query(
          `SELECT captured_tax_amount::text AS tax, captured_line_total::text AS total
             FROM quo.quotation_items WHERE id = $1`,
          [legacy]
        )
      ).rows[0];
      expect(stored).toEqual({ tax: '1.9752', total: '14.3202' });

      // Touching a money column is re-validated, so the residue cannot be edited into.
      await expectFail(
        c,
        '23514',
        `UPDATE quo.quotation_items SET captured_quantity = 2 WHERE id = $1`,
        [legacy]
      );
      // Issuing it would bill a residue no receipt settles: refused, naming the rule.
      await expectFail(c, '23514', `SELECT quo.issue_revision($1)`, [rev]);
      expect(
        await text(c, `SELECT status AS v FROM quo.quotation_revisions WHERE id = $1`, [rev])
      ).toBe('draft');
    });
  });

  it('keeps an ISSUED revision written under the four-decimal rule, and it reconciles under the new identity', async () => {
    /*
     * Before the rule: the migration's line trigger is switched off for this
     * transaction and the two CHECKs it dropped are put back (NOT VALID, so no
     * other row is examined). Lines with a fractional quantity and a
     * four-decimal unit price are written exactly as the earlier rule computed
     * them, and the revision is issued with the earlier quo.issue_revision's
     * arithmetic: subtotal round(SUM(unit x qty), 4). Then the re-issued
     * quo.guard_revision_totals checks it, the rule is switched back on, and the
     * re-issued quo.issue_revision supersedes it. Its captured figures must not
     * move at any step. Everything is rolled back.
     */
    await withRolledBackTx(admin, ctxA, async (c) => {
      await c.query(`ALTER TABLE quo.quotation_items DISABLE TRIGGER tg_quotation_items_money`);
      await c.query(
        `ALTER TABLE quo.quotation_items ADD CONSTRAINT ck_fd1_legacy_tax CHECK
           (captured_tax_amount = round((captured_unit_price * captured_quantity - captured_discount) * captured_tax_rate, 4)) NOT VALID`
      );
      await c.query(
        `ALTER TABLE quo.quotation_items ADD CONSTRAINT ck_fd1_legacy_line_total CHECK
           (captured_line_total = round(captured_unit_price * captured_quantity - captured_discount + captured_tax_amount, 4)) NOT VALID`
      );
      const { service } = await seedService(c, 'fd1_legacy_issued');
      const legacy = await draft(c, 'fd1_legacy_issued', 'JOD');
      // 1.2345 x 1.5 = 1.85175: net 1.8518 and tax round(1.85175 x 0.16, 4) =
      // 0.2963 at four decimals, total 2.1481 — none of them a whole fils.
      await item(c, legacy, service, 1, 'JOD', {
        unit: '1.2345',
        qty: '1.500',
        rate: '0.160000',
        tax: '0.2963',
        total: '2.1481',
      });
      await item(c, legacy, service, 2, 'JOD', {
        unit: '2.0000',
        qty: '0.250',
        rate: '0.160000',
        tax: '0.0800',
        total: '0.5800',
      });
      const OLD_ISSUE = `UPDATE quo.quotation_revisions r
           SET status = 'issued', issued_at = now(), captured_subtotal = t.sub,
               captured_discount_total = t.disc, captured_tax_total = t.tax, captured_grand_total = t.grand
          FROM (SELECT SUM(captured_unit_price * captured_quantity)::numeric(18,4) AS sub,
                       SUM(captured_discount) AS disc, SUM(captured_tax_amount) AS tax,
                       SUM(captured_line_total) AS grand
                  FROM quo.quotation_items WHERE quotation_revision_id = $1 AND deleted_at IS NULL) t
         WHERE r.id = $1`;
      await c.query(OLD_ISSUE, [legacy]);
      await c.query(
        `UPDATE quo.quotations q SET current_revision_id = r.id, status = 'active'
           FROM quo.quotation_revisions r WHERE r.id = $1 AND q.id = r.quotation_id`,
        [legacy]
      );

      // The case the per-line subtotal would disagree with — two lines whose
      // unit x qty each end in half a ten-thousandth — could never be issued
      // under the earlier rule: ck_quotation_revisions_totals refused the
      // earlier arithmetic (subtotal 3.7035, grand 4.2962, tax 0.5926).
      const workOrder = await c.query(
        `SELECT q.work_order_id AS v FROM quo.quotation_revisions r
           JOIN quo.quotations q ON q.id = r.quotation_id WHERE r.id = $1`,
        [legacy]
      );
      const diverging = await draft(c, 'fd1_legacy_diverging', 'JOD', workOrder.rows[0].v);
      for (const line of [1, 2]) {
        await item(c, diverging, service, line, 'JOD', {
          unit: '1.2345',
          qty: '1.500',
          rate: '0.160000',
          tax: '0.2963',
          total: '2.1481',
        });
      }
      await expectFail(c, '23514', OLD_ISSUE, [diverging]);

      // The re-issued deferred identity runs over the issued legacy revision now.
      await c.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      const snapshot = async (): Promise<unknown> =>
        (
          await c.query(
            `SELECT r.captured_subtotal::text AS sub, r.captured_discount_total::text AS disc,
                    r.captured_tax_total::text AS tax, r.captured_grand_total::text AS grand,
                    r.issued_at,
                    (SELECT json_agg(json_build_array(i.captured_unit_price::text, i.captured_quantity::text,
                                                      i.captured_tax_amount::text, i.captured_line_total::text)
                                     ORDER BY i.line_number)
                       FROM quo.quotation_items i WHERE i.quotation_revision_id = r.id) AS lines
               FROM quo.quotation_revisions r WHERE r.id = $1`,
            [legacy]
          )
        ).rows[0];
      const before = await snapshot();
      expect(before).toMatchObject({
        sub: '2.3518',
        disc: '0.0000',
        tax: '0.3763',
        grand: '2.7281',
      });

      // The rule is back; a new revision is priced and issued under it, which
      // supersedes the legacy one without touching a figure of it.
      await c.query(`ALTER TABLE quo.quotation_items DROP CONSTRAINT ck_fd1_legacy_tax`);
      await c.query(`ALTER TABLE quo.quotation_items DROP CONSTRAINT ck_fd1_legacy_line_total`);
      await c.query(`ALTER TABLE quo.quotation_items ENABLE TRIGGER tg_quotation_items_money`);
      const next = (
        await c.query(
          `INSERT INTO quo.quotation_revisions (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code, created_by)
           SELECT tenant_id, company_id, branch_id, quotation_id, 2, currency_code, created_by
             FROM quo.quotation_revisions WHERE id = $1 RETURNING id`,
          [legacy]
        )
      ).rows[0].id as string;
      await item(c, next, service, 1, 'JOD', {
        unit: '12.3450',
        qty: '1.000',
        rate: '0.160000',
        tax: '1.9750',
        total: '14.3200',
      });
      await c.query(`SELECT quo.issue_revision($1)`, [next]);
      await c.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      expect(
        await text(c, `SELECT status AS v FROM quo.quotation_revisions WHERE id = $1`, [legacy])
      ).toBe('superseded');
      expect(await snapshot()).toEqual(before);
    });
  });

  it('keeps an ISSUED invoice with a four-decimal gross, and its outstanding balance is that gross exactly', async () => {
    // Invoice amounts carry no minor-unit guard, before the rule or after it: an
    // invoice issued from four-decimal lines is stored as it was, and the
    // outstanding read neither rounds it nor rewrites it. Its sub-fils residue
    // is real (ADR-023 Consequences): only a full return credits it exactly.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd1legacyinv');
      const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR, currency: 'JOD' });
      await addInvoiceLine(c, invoice, {
        lineNumber: 1,
        net: '1.8518',
        tax: '0.2963',
        quantity: 1.5,
        unitPrice: '1.2345',
        currency: 'JOD',
      });
      await issueInvoice(c, invoice);
      await c.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      const stored = (
        await c.query(
          `SELECT i.status, a.net_total::text AS net, a.tax_total::text AS tax,
                  a.gross_total::text AS gross, la.gross_amount::text AS line_gross,
                  sal.invoice_open_receivable(i.id)::text AS open,
                  shared.fits_minor_unit(a.gross_total, i.currency_code) AS fits
             FROM sal.invoices i
             JOIN sal.invoice_amounts a ON a.invoice_id = i.id
             JOIN sal.invoice_line_amounts la ON la.invoice_id = i.id
            WHERE i.id = $1`,
          [invoice]
        )
      ).rows[0];
      expect(stored).toEqual({
        status: 'issued',
        net: '1.8518',
        tax: '0.2963',
        gross: '2.1481',
        line_gross: '2.1481',
        open: '2.1481',
        fits: false,
      });
    });
  });

  it('the migration writes no row: no INSERT, UPDATE or DELETE outside a function body', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          '../../supabase/migrations/20260930100000_sal_minor_unit_rounding.sql',
          import.meta.url
        )
      ),
      'utf8'
    );
    const topLevel = sql
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(topLevel).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i);
    // The one DO block reads and raises a NOTICE; its body is stripped above with
    // the functions', so it is checked on its own: it may only SELECT.
    const doBlock = /DO \$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? '';
    expect(doBlock).toContain('RAISE NOTICE');
    expect(doBlock).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i);
  });
});
