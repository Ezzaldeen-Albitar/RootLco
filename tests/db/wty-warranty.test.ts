/**
 * Phase 1-11 — wty warranty: issue_warranty binding terms to the delivery (M-wty-2),
 * effective-dated coverage selection at the service date (BR-WTY-001), no-overlap
 * live warranty records per vehicle+coverage (M-wty-1), issued-record freeze, and the
 * coverage no-overlap EXCLUDE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import {
  seedP111Base,
  ctxA,
  expectFail,
  buildReadyDelivery,
  seedCompletedDelivery,
  seedWarrantyPolicy,
  seedWarrantyCoverage,
  issueWarranty,
} from './p1-11-helpers';

const admin = adminPool();
const runtime = runtimePool();

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('p1-11 wty warranty', () => {
  it('binds odometer_at_issue and start_date to the delivery (M-wty-2)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery, vehicle } = await seedCompletedDelivery(c, 'w1', { odometer: 45000 });
      const policy = await seedWarrantyPolicy(c, 'w1');
      const coverage = await seedWarrantyCoverage(c, policy, {
        durationMonths: 12,
        effectiveFrom: '2026-01-01',
      });
      const w = await issueWarranty(c, delivery, policy);
      const rec = (
        await c.query(
          `SELECT vehicle_id, delivery_record_id, coverage_id, odometer_at_issue, start_date, expiry_date, status FROM wty.warranty_records WHERE id=$1`,
          [w]
        )
      ).rows[0];
      const deliveredAt = (
        await c.query(`SELECT delivered_at::date d FROM sal.delivery_records WHERE id=$1`, [
          delivery,
        ])
      ).rows[0].d;
      expect(rec.vehicle_id).toBe(vehicle);
      expect(rec.delivery_record_id).toBe(delivery);
      expect(rec.coverage_id).toBe(coverage);
      expect(rec.odometer_at_issue).toBe(45000);
      expect(new Date(rec.start_date).toISOString().slice(0, 10)).toBe(
        new Date(deliveredAt).toISOString().slice(0, 10)
      );
      expect(rec.status).toBe('issued');
    });
  });

  it('uses the coverage effective at the service date, not another period (BR-WTY-001)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery } = await seedCompletedDelivery(c, 'w2');
      const policy = await seedWarrantyPolicy(c, 'w2');
      // early window (closed) and current window (open); delivery date (today) falls in the current one.
      await seedWarrantyCoverage(c, policy, {
        durationMonths: 6,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-07-01',
      });
      const current = await seedWarrantyCoverage(c, policy, {
        durationMonths: 24,
        effectiveFrom: '2026-07-01',
      });
      const w = await issueWarranty(c, delivery, policy);
      const rec = (
        await c.query(
          `SELECT coverage_id, (expiry_date = (start_date + interval '24 months')::date) AS uses24 FROM wty.warranty_records WHERE id=$1`,
          [w]
        )
      ).rows[0];
      expect(rec.coverage_id).toBe(current);
      expect(rec.uses24).toBe(true);
    });
  });

  it('rejects an overlapping live warranty record for the same vehicle+coverage (M-wty-1 23P01)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery, vehicle, wo } = await seedCompletedDelivery(c, 'w3');
      const policy = await seedWarrantyPolicy(c, 'w3');
      const coverage = await seedWarrantyCoverage(c, policy, { durationMonths: 12 });
      const w = await issueWarranty(c, delivery, policy);
      const r = (
        await c.query(`SELECT start_date, expiry_date FROM wty.warranty_records WHERE id=$1`, [w])
      ).rows[0];
      await expectFail(
        c,
        '23P01',
        `INSERT INTO wty.warranty_records
           (tenant_id, company_id, branch_id, vehicle_id, work_order_id, delivery_record_id, policy_id, coverage_id, start_date, expiry_date, odometer_at_issue, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1000,'issued',$11)`,
        [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          vehicle,
          wo,
          delivery,
          policy,
          coverage,
          r.start_date,
          r.expiry_date,
          USER_A,
        ]
      );
    });
  });

  it('freezes an issued warranty record (freeze guard 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery } = await seedCompletedDelivery(c, 'w4');
      const policy = await seedWarrantyPolicy(c, 'w4');
      await seedWarrantyCoverage(c, policy, { durationMonths: 12 });
      const w = await issueWarranty(c, delivery, policy);
      await expectFail(
        c,
        '23514',
        `UPDATE wty.warranty_records SET odometer_at_issue = 1 WHERE id=$1`,
        [w]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE wty.warranty_records SET start_date = start_date + 1 WHERE id=$1`,
        [w]
      );
    });
  });

  it('rejects a warranty record against a non-delivered delivery (coherence guard 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // a READY-but-not-completed delivery (custody not released, status <> 'delivered').
      const { delivery, vehicle, wo } = await buildReadyDelivery(c, 'wcoh');
      const policy = await seedWarrantyPolicy(c, 'wcoh');
      const coverage = await seedWarrantyCoverage(c, policy, { durationMonths: 12 });
      // a raw insert bypassing wty.issue_warranty must still be refused: the delivery is
      // not 'delivered', so no warranty may be issued against it.
      await expectFail(
        c,
        '23514',
        `INSERT INTO wty.warranty_records
           (tenant_id, company_id, branch_id, vehicle_id, work_order_id, delivery_record_id, policy_id, coverage_id, start_date, expiry_date, odometer_at_issue, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,DATE '2026-07-01',DATE '2027-07-01',1000,'issued',$9)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, vehicle, wo, delivery, policy, coverage, USER_A]
      );
    });
  });

  it('rejects overlapping active coverage for the same policy+scope (ex_warranty_coverage_no_overlap 23P01)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const policy = await seedWarrantyPolicy(c, 'w5');
      await seedWarrantyCoverage(c, policy, { durationMonths: 12, effectiveFrom: '2026-01-01' });
      await expectFail(
        c,
        '23P01',
        `INSERT INTO wty.warranty_coverage (tenant_id, company_id, policy_id, covered_scope, duration_months, effective_from, created_by)
         VALUES ($1,$2,$3,'all',12,DATE '2026-06-01',$4)`,
        [TENANT_A, COMPANY_A1, policy, USER_A]
      );
    });
  });
});
