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
]);

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
          AND table_schema IN ('org', 'iam', 'shared', 'crm', 'veh', 'apt', 'rec')
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
});
