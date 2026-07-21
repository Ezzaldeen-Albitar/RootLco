/**
 * Phase 1-12 — integrated cross-domain end-to-end scenario (Wave 3).
 *
 * Runs the COMPLETE Release-2 data path in one committed flow for the fully-provisioned
 * tenant A, spanning every business domain:
 *   service/price (svc) → inventory (inv) → vehicle (veh) → reception visit + custody
 *   acceptance (rec) → work order (wo) → quotation revision (quo) → invoice + line (sal)
 *   → issue → receipt → allocation → delivery + custody release (sal/rec) → warranty (wty)
 *   → financial events (sal).
 * Then it RECONCILES the cross-domain invariants (open receivable, financial-event
 * completeness, custody-released-once, warranty↔delivery link, inventory on-hand, quo↔sal
 * forward FK) and proves complete isolation of the committed dataset from a second tenant,
 * a second branch, and a no-context session — with a cross-tenant write denied.
 *
 * This is the P1-12 integration gate: it does not re-test each domain (the per-phase suites
 * do) but proves the domains compose into one coherent, reconciling, isolated transaction.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withCommittedTx,
  withRolledBackTx,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import {
  seedP111Base,
  cleanP111Committed,
  ctxA,
  seedPartner,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
  issueInvoice,
  seedReceipt,
  allocateReceipt,
  insertDeliveryRecord,
  insertMandatoryChecklist,
  passAllMandatory,
  insertAuthorizedReceiver,
  insertSignature,
  completeDelivery,
  seedWarrantyPolicy,
  seedWarrantyCoverage,
  issueWarranty,
  P11,
  P9,
} from './p1-11-helpers';
import {
  seedService,
  seedItem,
  seedLocations,
  seedStock,
  seedQuotation,
  draftRevision,
  addServiceItem,
} from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const BRANCH_A2 = 'a1100000-0000-4000-8000-0000000000a2';
const ctxB = { tenantId: TENANT_B, userId: USER_B };
const noCtx = {};

// The committed integrated dataset (ids captured for reconciliation + isolation).
type Ids = Record<
  | 'wo'
  | 'vehicle'
  | 'visit'
  | 'quotation'
  | 'revision'
  | 'invoice'
  | 'receipt'
  | 'item'
  | 'warehouse'
  | 'delivery'
  | 'warranty'
  | 'policy',
  string
>;
let ids: Ids;

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  // A second branch in company A1 for the branch-isolation dimension.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2','Fixture Branch A2','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );

  ids = await withCommittedTx(runtime, ctxA, async (c) => {
    const tag = 'p12e2e';
    // svc + pricing (published)
    const svc = await seedService(c, tag);
    // inventory: item + warehouse + 50 on hand (approved opening batch)
    const { item } = await seedItem(c, tag);
    const { warehouse } = await seedLocations(c, tag);
    await seedStock(c, item, warehouse, 50, tag);
    // partner + vehicle + authorized reception visit (custody accepted) + work order
    const payer = await seedPartner(c, tag, 'E2E Payer');
    const { wo, vehicle, visit } = await makeWorkOrder(c, tag);
    // quotation revision on the work order (quo)
    const quotation = await seedQuotation(c, wo, tag);
    const revision = await draftRevision(c, quotation, 1);
    await addServiceItem(c, revision, svc.service, 1, 100, 1);
    // invoice bound to the quotation revision (quo → sal forward FK), one 100/0 line
    const invoice = await seedDraftInvoice(c, { wo, payer, quotationRevision: revision });
    await addInvoiceLine(c, invoice, { lineNumber: 1, net: 100, tax: 0 });
    await issueInvoice(c, invoice);
    // full payment
    const receipt = await seedReceipt(c, { amount: 100, payer });
    await allocateReceipt(c, receipt, invoice, 100);
    // delivery + custody release — for the SAME work order/vehicle/visit as the invoice
    const delivery = await insertDeliveryRecord(c, { wo, vehicle, visit });
    await insertMandatoryChecklist(c, tag);
    await passAllMandatory(c, delivery);
    await insertAuthorizedReceiver(c, delivery, P9.AP); // the visit's approving reception party
    await insertSignature(c, delivery);
    await completeDelivery(c, delivery, 120000);
    // warranty issued against the delivered vehicle/work order
    const policy = await seedWarrantyPolicy(c, tag);
    await seedWarrantyCoverage(c, policy, { durationMonths: 12, effectiveFrom: '2026-01-01' });
    const warranty = await issueWarranty(c, delivery, policy);
    // fire deferred reconcile + completeness now
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    return {
      wo,
      vehicle,
      visit,
      quotation,
      revision,
      invoice,
      receipt,
      item,
      warehouse,
      delivery,
      warranty,
      policy,
    };
  });
});

afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.query(`DELETE FROM org.branches WHERE id=$1`, [BRANCH_A2]);
  await admin.end();
  await runtime.end();
});

const n = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await admin.query(sql, params)).rows[0].c);

describe('p1-12 integrated cross-domain scenario', () => {
  it('creates every entity in the correct scope with valid forward FKs (quo→sal, sal→rec/veh/wo)', async () => {
    // the invoice is bound to the quotation revision (quo → sal forward FK)
    const inv = (
      await admin.query(
        `SELECT quotation_revision_id, work_order_id, status FROM sal.invoices WHERE id=$1`,
        [ids.invoice]
      )
    ).rows[0];
    expect(inv.quotation_revision_id).toBe(ids.revision);
    expect(inv.work_order_id).toBe(ids.wo);
    expect(inv.status).toBe('issued');
    // warranty bound to the delivered vehicle + work order + delivery
    const w = (
      await admin.query(
        `SELECT vehicle_id, work_order_id, delivery_record_id FROM wty.warranty_records WHERE id=$1`,
        [ids.warranty]
      )
    ).rows[0];
    expect(w.vehicle_id).toBe(ids.vehicle);
    expect(w.work_order_id).toBe(ids.wo);
    expect(w.delivery_record_id).toBe(ids.delivery);
  });

  it('reconciles the invoice to fully paid (open receivable = 0)', async () => {
    const open = Number(
      (await admin.query(`SELECT sal.invoice_open_receivable($1) o`, [ids.invoice])).rows[0].o
    );
    expect(open).toBe(0);
  });

  it('has complete financial-event provenance (issued + recorded + allocated, exactly one each)', async () => {
    expect(
      await n(
        `SELECT count(*)::int c FROM sal.financial_events WHERE source_id=$1 AND event_type='invoice_issued'`,
        [ids.invoice]
      )
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*)::int c FROM sal.financial_events WHERE source_id=$1 AND event_type='receipt_recorded'`,
        [ids.receipt]
      )
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*)::int c FROM sal.financial_events fe JOIN sal.payment_allocations pa ON pa.id=fe.source_id WHERE pa.invoice_id=$1 AND fe.event_type='payment_allocated'`,
        [ids.invoice]
      )
    ).toBe(1);
  });

  it('releases custody exactly once for the reception visit', async () => {
    expect(
      await n(
        `SELECT count(*)::int c FROM rec.custody_history WHERE reception_visit_id=$1 AND to_state='released'`,
        [ids.visit]
      )
    ).toBe(1);
  });

  it('reconciles inventory on-hand from the approved opening batch (50 at the warehouse)', async () => {
    // net movement quantity for the item at the warehouse equals the opening quantity
    const onHand = await n(
      `SELECT COALESCE(sum(signed_qty),0)::int c FROM inv.stock_movements WHERE item_id=$1 AND location_id=$2`,
      [ids.item, ids.warehouse]
    );
    expect(onHand).toBe(50);
  });

  it('hides the entire committed dataset from tenant B and a no-context session (isolation matrix)', async () => {
    const probes: Array<[string, string]> = [
      ['veh.vehicles', ids.vehicle],
      ['wo.work_orders', ids.wo],
      ['quo.quotations', ids.quotation],
      ['quo.quotation_revisions', ids.revision],
      ['inv.item_master', ids.item],
      ['inv.stock_locations', ids.warehouse],
      ['sal.invoices', ids.invoice],
      ['sal.receipts', ids.receipt],
      ['sal.delivery_records', ids.delivery],
      ['wty.warranty_records', ids.warranty],
    ];
    for (const ctx of [ctxB, noCtx]) {
      await withRolledBackTx(runtime, ctx, async (c) => {
        for (const [tbl, id] of probes) {
          const c2 = Number(
            (await c.query(`SELECT count(*)::int c FROM ${tbl} WHERE id=$1`, [id])).rows[0].c
          );
          expect(c2, `${tbl} visible to ${ctx === noCtx ? 'no-context' : 'tenant B'}`).toBe(0);
        }
      });
    }
  });

  it('hides branch-A1 rows from a branch-A2-scoped tenant-A session (branch isolation)', async () => {
    await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A, companyIds: [COMPANY_A1], branchIds: [BRANCH_A2] },
      async (c) => {
        expect(
          Number(
            (await c.query(`SELECT count(*)::int c FROM sal.invoices WHERE id=$1`, [ids.invoice]))
              .rows[0].c
          )
        ).toBe(0);
        expect(
          Number(
            (await c.query(`SELECT count(*)::int c FROM wo.work_orders WHERE id=$1`, [ids.wo]))
              .rows[0].c
          )
        ).toBe(0);
      }
    );
  });

  it('denies a cross-tenant write into the integrated financial domain', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      await c.query('SAVEPOINT sp');
      let ok = false;
      try {
        await c.query(
          `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code, created_by)
           VALUES ($1,$2,$3,$4,$5,'USD',$6)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, ids.wo, P11.PM_CASH, USER_B]
        );
        ok = true;
      } catch {
        ok = false;
      }
      await c.query('ROLLBACK TO SAVEPOINT sp');
      expect(ok, 'tenant B could write a tenant-A invoice').toBe(false);
    });
  });
});
