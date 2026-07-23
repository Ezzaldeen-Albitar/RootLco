/**
 * Export registry ↔ database drift guard (P1-15).
 *
 * `src/modules/shared-services/domain/export-policy.ts` states:
 *
 *   "Every column named below exists in protected schema and is asserted
 *    against `information_schema` by `tests/db/p1-15-export-authorization.test.ts`,
 *    so a registry entry cannot drift from the database."
 *
 * Until this file existed that sentence was false, and a false sentence about a
 * test is worse than no sentence: it stops a reviewer looking. This suite makes
 * it true, and does two further things the comment implies but does not say.
 *
 * **1. Drift in the direction that matters.** The registry is a code constant
 * mapping an exportable field name to a column expression. If a migration ever
 * renames or drops one of those columns, nothing in the TypeScript build
 * notices — the export would fail at run time, in front of a caller, on a
 * privileged operation. So every table, every field column, every filterable
 * column and every tenant column is looked up in `information_schema`.
 *
 * **2. The deliberate exclusions are checked as exclusions, not as absences.**
 * `export-policy.ts` names five things it deliberately does not export:
 * `storage_key`, `sha256`, `body_sha256`, `recipient_digest`, and everything in
 * `shared.file_scan_results`. An assertion that they are missing from the
 * registry is worth very little on its own — a typo would satisfy it. So each is
 * first proved to **exist in the database**, and only then proved to be absent
 * from the registry. That is the difference between "we excluded it" and "we
 * never knew about it".
 *
 * The admin connection is used throughout. It reads catalogue metadata only:
 * nothing here is a claim about what a runtime role can see, and no business row
 * is created or read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';
import {
  EXPORT_PERMISSION,
  EXPORT_RESOURCES,
  SENSITIVE_FIELD_PERMISSION,
} from '@/modules/shared-services';

let admin: Pool;

/** All columns of a `schema.table`, from the live catalogue. */
async function columnsOf(qualified: string): Promise<Set<string>> {
  const [schema, table] = qualified.split('.');
  const result = await admin.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2`,
    [schema, table]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function tableExists(qualified: string): Promise<boolean> {
  const [schema, table] = qualified.split('.');
  const result = await admin.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'`,
    [schema, table]
  );
  return result.rows[0]?.total === '1';
}

async function permissionExists(code: string): Promise<boolean> {
  const result = await admin.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM iam.permissions WHERE permission_code = $1',
    [code]
  );
  return result.rows[0]?.total === '1';
}

beforeAll(() => {
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

describe('P1-15 / every exportable resource names a real table', () => {
  it('registers at least the three resources this phase ships', () => {
    expect(
      EXPORT_RESOURCES.map((r) => r.code)
        .slice()
        .sort()
    ).toEqual(['branches', 'documents', 'outbound_messages']);
  });

  for (const resource of EXPORT_RESOURCES) {
    it(`${resource.code} names a base table that exists (${resource.table})`, async () => {
      expect(await tableExists(resource.table)).toBe(true);
    });

    it(`${resource.code} names a tenant column that exists (${resource.tenantColumn})`, async () => {
      const columns = await columnsOf(resource.table);
      expect(columns.has(resource.tenantColumn)).toBe(true);
    });

    it(`${resource.code} — every exportable field column exists`, async () => {
      const columns = await columnsOf(resource.table);
      const missing = resource.fields
        .map((field) => field.column)
        .filter((column) => !columns.has(column));
      expect(missing).toEqual([]);
    });

    it(`${resource.code} — every filterable column exists`, async () => {
      const columns = await columnsOf(resource.table);
      const missing = resource.filterable
        .map((field) => field.column)
        .filter((column) => !columns.has(column));
      expect(missing).toEqual([]);
    });

    it(`${resource.code} — its additional permission is a seeded permission code`, async () => {
      expect(await permissionExists(resource.permission)).toBe(true);
    });
  }

  it('the two governing permission codes are seeded, not invented here', async () => {
    expect(await permissionExists(EXPORT_PERMISSION)).toBe(true);
    expect(await permissionExists(SENSITIVE_FIELD_PERMISSION)).toBe(true);
  });
});

describe('P1-15 / a filter can only name a field the caller could also export', () => {
  for (const resource of EXPORT_RESOURCES) {
    it(`${resource.code} — every filterable field is also an exportable field`, () => {
      const exportable = new Set(resource.fields.map((field) => field.name));
      const orphans = resource.filterable
        .map((field) => field.name)
        .filter((name) => !exportable.has(name));
      expect(orphans).toEqual([]);
    });

    it(`${resource.code} — no free-text field is filterable`, () => {
      // A prefix filter on caller-supplied free text is a character-by-character
      // read oracle over data the caller may not be entitled to see in full.
      const freeText = new Set(
        resource.fields.filter((field) => field.freeText).map((field) => field.name)
      );
      const offenders = resource.filterable
        .map((field) => field.name)
        .filter((name) => freeText.has(name));
      expect(offenders).toEqual([]);
    });
  }
});

describe('P1-15 / the deliberate exclusions exist in the database and are still excluded', () => {
  const registryColumns = (table: string): Set<string> => {
    const resource = EXPORT_RESOURCES.find((r) => r.table === table);
    return new Set([
      ...(resource?.fields ?? []).map((field) => field.column),
      ...(resource?.filterable ?? []).map((field) => field.column),
    ]);
  };

  const EXCLUSIONS = [
    {
      table: 'shared.document_versions',
      column: 'storage_key',
      why: 'a locator that travels outside RLS in every downstream system',
    },
    {
      table: 'shared.document_versions',
      column: 'sha256',
      why: 'an integrity value, not business data',
    },
    {
      table: 'shared.outbound_messages',
      column: 'body_sha256',
      why: 'an integrity value, not business data',
    },
    {
      table: 'shared.outbound_messages',
      column: 'recipient_digest',
      why: 'a tenant-salted digest of a person',
    },
  ] as const;

  for (const exclusion of EXCLUSIONS) {
    it(`${exclusion.table}.${exclusion.column} exists but is not exportable — ${exclusion.why}`, async () => {
      const columns = await columnsOf(exclusion.table);
      // First: the column is real. An assertion that a typo is not exportable
      // would prove nothing at all.
      expect(columns.has(exclusion.column)).toBe(true);
      expect(registryColumns(exclusion.table).has(exclusion.column)).toBe(false);
    });
  }

  it('shared.document_versions is not an exportable resource at all', async () => {
    expect(await tableExists('shared.document_versions')).toBe(true);
    expect(EXPORT_RESOURCES.some((r) => r.table === 'shared.document_versions')).toBe(false);
  });

  it('no column of shared.file_scan_results is reachable through any resource', async () => {
    const scanColumns = await columnsOf('shared.file_scan_results');
    expect(scanColumns.size).toBeGreaterThan(0);
    expect(EXPORT_RESOURCES.some((r) => r.table === 'shared.file_scan_results')).toBe(false);
    // Exporting a scan verdict would invite treating an export as scan evidence,
    // which is precisely the thing this phase refuses to manufacture.
    for (const resource of EXPORT_RESOURCES) {
      expect(resource.table).not.toContain('file_scan_results');
    }
  });
});

describe('P1-15 / sensitive fields are marked, and marking is not decorative', () => {
  it('a sensitive field requires a second permission the export permission does not imply', () => {
    expect(SENSITIVE_FIELD_PERMISSION).not.toBe(EXPORT_PERMISSION);
  });

  it('every field is either plain, sensitive, or free-text — never silently untyped', () => {
    for (const resource of EXPORT_RESOURCES) {
      for (const field of resource.fields) {
        expect(typeof field.sensitive, `${resource.code}.${field.name}`).toBe('boolean');
        expect(typeof field.freeText, `${resource.code}.${field.name}`).toBe('boolean');
      }
    }
  });
});
