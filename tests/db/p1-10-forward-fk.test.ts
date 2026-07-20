/**
 * Phase 1-10 — P1-09 forward-FK completion (service_ref, item_ref, quotation_revision_ref).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool, cleanFixtures } from './helpers';

const admin = adminPool();

beforeAll(async () => {});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
});

const fkDef = async (name: string) =>
  (
    await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def, confdeltype FROM pg_constraint WHERE conname=$1`,
      [name]
    )
  ).rows[0];

describe('p1-09 forward FKs', () => {
  it('resolves service_ref -> svc.services (composite, ON DELETE RESTRICT)', async () => {
    const c = await fkDef('fk_work_order_service_lines_service');
    expect(c.def).toContain('FOREIGN KEY (tenant_id, service_ref)');
    expect(c.def).toContain('REFERENCES svc.services(tenant_id, id)');
    expect(c.confdeltype).toBe('r'); // RESTRICT
  });

  it('resolves item_ref -> inv.item_master (composite, ON DELETE RESTRICT)', async () => {
    const c = await fkDef('fk_required_parts_item');
    expect(c.def).toContain('FOREIGN KEY (tenant_id, item_ref)');
    expect(c.def).toContain('REFERENCES inv.item_master(tenant_id, id)');
    expect(c.confdeltype).toBe('r');
  });

  it('resolves quotation_revision_ref -> quo.quotation_revisions (full scope, ON DELETE RESTRICT)', async () => {
    const c = await fkDef('fk_customer_approvals_quotation_revision');
    expect(c.def).toContain(
      'FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_ref)'
    );
    expect(c.def).toContain(
      'REFERENCES quo.quotation_revisions(tenant_id, company_id, branch_id, id)'
    );
    expect(c.confdeltype).toBe('r');
  });

  it('every forward FK has a non-partial covering index', async () => {
    const { rows } = await admin.query(
      `WITH fks AS (
         SELECT c.conname, c.conrelid, c.conkey
         FROM pg_constraint c
         WHERE c.conname IN ('fk_work_order_service_lines_service','fk_required_parts_item','fk_customer_approvals_quotation_revision')
       )
       SELECT f.conname FROM fks f
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_index i WHERE i.indrelid=f.conrelid AND i.indpred IS NULL
           AND (SELECT array_agg(k ORDER BY k) FROM unnest(f.conkey) k)
             = (SELECT array_agg(k ORDER BY k) FROM unnest((i.indkey::int2[])[0:array_length(f.conkey,1)-1]) k))`
    );
    expect(rows.map((r) => r.conname)).toEqual([]);
  });

  it('confirms wo.jobs carries no service reference (reconciliation)', async () => {
    const { rows } = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='wo' AND table_name='jobs' AND column_name IN ('service_id','service_ref')`
    );
    expect(rows).toEqual([]);
  });
});
