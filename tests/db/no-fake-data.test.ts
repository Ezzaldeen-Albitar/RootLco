/**
 * No-fake-data policy — catalog-driven clean business-state invariant.
 *
 * Every base table in org/iam/shared is a business table unless it appears in
 * the exact structural-reference allow-list. New tables therefore join the
 * empty set automatically and force an explicit classification review.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, cleanFixtures } from './helpers';

const STRUCTURAL_REFERENCE = new Set([
  'shared.currencies',
  'shared.timezones',
  'shared.languages',
  'iam.permissions',
  'shared.retention_classes',
  // Phase 1-9 platform work-order/job state graph — structurally mandatory (the
  // transition guards enforce against these rows; the app cannot route work
  // without them). Platform scope only; tenant-neutral; no business data.
  'wo.work_order_states',
  'wo.work_order_transitions',
  'wo.job_states',
  'wo.job_transitions',
  // Phase 1-10 platform unit-of-measure catalog — structurally mandatory (a
  // quantity/movement is meaningless without a unit). Platform scope only.
  'inv.units_of_measure',
  'sal.payment_methods',
  // P1-OD-025 platform evidence-category catalog — structurally mandatory, on
  // exactly the argument the work-order state graph is allow-listed under: the
  // reception guards enforce AGAINST these rows by `category_code`
  // (`rec.guard_reception_evidence_binding` resolves `reception_exterior`,
  // `reception_vin`, `reception_signature` and the rest), so a reception cannot
  // record evidence without them any more than work can be routed without a
  // state graph. Platform scope only; tenant-neutral; no business data — and
  // that scope restriction is not taken on trust, it is asserted below.
  'shared.document_categories',
]);

/**
 * Allow-listing a table skips it WHOLE, which for a dual-scope table would hand
 * business rows a place to hide: `shared.document_categories` holds platform
 * defaults AND tenant overrides in one table, and only the first half is
 * configuration. So the exemption is paid for by the case below, which holds the
 * half the allow-list stops watching.
 */
const DUAL_SCOPE_EXEMPTIONS = [
  { table: 'shared.document_categories', tenantColumn: 'tenant_id' },
] as const;

let admin: Pool;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

beforeAll(async () => {
  admin = adminPool();
  await cleanFixtures(admin);
});

afterAll(async () => {
  await admin.end();
});

describe('no-fake-data — all business tables start empty', () => {
  it('discovers every org/iam/shared/crm/veh base table and finds no business rows', async () => {
    const catalog = await admin.query(
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema IN ('org', 'iam', 'shared', 'crm', 'veh', 'apt', 'rec', 'wo', 'dia', 'tech', 'qms', 'svc', 'quo', 'inv', 'sal', 'wty', 'rpt')
        ORDER BY table_schema, table_name`
    );
    const nonEmpty: string[] = [];
    for (const table of catalog.rows) {
      const fq = `${table.table_schema}.${table.table_name}`;
      if (STRUCTURAL_REFERENCE.has(fq)) continue;
      const { rows } = await admin.query(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(
          table.table_schema
        )}.${quoteIdentifier(table.table_name)}`
      );
      if (rows[0].count !== 0) nonEmpty.push(`${fq} (${rows[0].count} rows)`);
    }
    expect(
      nonEmpty,
      `business tables must be empty after fixture cleanup: ${nonEmpty.join(', ')}`
    ).toEqual([]);
  });

  it('holds the half the allow-list stops watching: no TENANT rows in a dual-scope catalog', async () => {
    const offenders: string[] = [];
    for (const { table, tenantColumn } of DUAL_SCOPE_EXEMPTIONS) {
      const [schema, name] = table.split('.');
      const { rows } = await admin.query(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(schema!)}.${quoteIdentifier(name!)}
          WHERE ${quoteIdentifier(tenantColumn)} IS NOT NULL`
      );
      if (rows[0].count !== 0) offenders.push(`${table} (${rows[0].count} tenant rows)`);
    }
    expect(
      offenders,
      `a dual-scope catalog is exempt only for its PLATFORM rows: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('the exemption is real — the allow-listed catalog does carry its platform rows', async () => {
    /*
     * Anti-vacuity, and specifically about the shape of the exemption above. If
     * the platform rows ever stopped existing, the tenant-scope case would pass
     * over an empty table and report nothing, while the reception guards it
     * exists to justify would refuse every binding. The exemption has to be
     * earned by rows that are actually there.
     */
    const { rows } = await admin.query(
      `SELECT count(*)::int AS count FROM shared.document_categories WHERE tenant_id IS NULL`
    );
    expect(rows[0].count).toBeGreaterThan(0);
  });
});
