/**
 * No-fake-data policy — clean-database business-table emptiness.
 *
 * The RootLco permanent data policy: the application ships and starts with NO
 * fabricated business data. The migration layer must create zero business rows;
 * business tables are populated only by real users through real workflows (or,
 * transiently, by isolated automated tests that clean up after themselves).
 *
 * This suite removes any test leftovers (cleanFixtures) and then asserts that the
 * shared-services BUSINESS tables hold no rows. Structural reference tables
 * (retention_classes, currencies, languages, permissions, …) are intentionally
 * excluded — those hold approved system definitions, not business records.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, cleanFixtures } from './helpers';

// Tables that MUST be empty on a clean database (no seed populates them; they are
// filled only by real users or by isolated tests that clean up). Future-increment
// tables are listed now and skipped until they exist (to_regclass IS NULL).
const BUSINESS_TABLES = [
  'shared.documents',
  'shared.document_categories',
  'shared.document_versions',
  'shared.file_scan_results',
  'shared.document_links',
  'shared.legal_holds',
  'shared.message_templates',
  'shared.template_versions',
  'shared.outbound_messages',
  'shared.delivery_attempts',
  'shared.event_outbox',
  'shared.processed_events',
  'shared.error_records',
  'shared.search_metadata',
  'shared.tags',
  'shared.entity_tags',
  'shared.notes',
  'shared.comments',
];

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await cleanFixtures(admin); // clear any ephemeral rows other suites may have left
});

afterAll(async () => {
  await admin.end();
});

describe('no-fake-data — business tables start empty', () => {
  it('every existing shared business table has zero rows', async () => {
    const nonEmpty: string[] = [];
    for (const fq of BUSINESS_TABLES) {
      const exists = await admin.query(`SELECT to_regclass($1) AS oid`, [fq]);
      if (!exists.rows[0].oid) continue; // table not created yet (future increment)
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ${fq}`);
      if (rows[0].n !== 0) nonEmpty.push(`${fq} (${rows[0].n} rows)`);
    }
    expect(
      nonEmpty,
      `business tables must be empty on a clean database (no fake/demo/seeded business data): ${nonEmpty.join(', ')}`
    ).toEqual([]);
  });
});
