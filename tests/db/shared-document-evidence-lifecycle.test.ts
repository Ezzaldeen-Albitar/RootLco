/**
 * P1-OD-025 — the scanner handoff and the category policy, at SQL level.
 *
 * `shared.begin_document_scan` and `shared.complete_document_scan` are the ONLY
 * way a version leaves `pending`, and they exist because of what the schema
 * deliberately withholds: `app_runtime` has no INSERT on
 * `shared.file_scan_results` and no terminal UPDATE on
 * `shared.document_versions`, so request code cannot fabricate a verdict. Two
 * narrow `SECURITY DEFINER` functions replace that with a path that re-checks
 * tenant, actor, permission and source state on every call.
 *
 * The properties proved here, each named by the decision that requires it:
 *
 *  - **scanner failure must NOT auto-accept.** An `error` verdict quarantines.
 *    There is no argument, no retry-and-hope, and no default-accept branch.
 *  - **acceptance requires an exclusively clean scan.** A clean verdict beside
 *    an infected one does not accept; an error verdict alone does not accept.
 *  - **a terminal version is immutable.** Accepted, quarantined and rejected all
 *    refuse every onward transition, which is what makes "a rejected or
 *    quarantined version can never satisfy evidence" a property rather than a
 *    convention.
 *  - **cross-tenant is refused at the function boundary**, not only by RLS —
 *    these functions run as their definer, so RLS is not what stops them.
 *  - **the category policy is data the server reads**, so
 *    `device_capture_timestamp_required` cannot be turned off by a client.
 *
 * Connection discipline, as elsewhere in this tier: capability and denial claims
 * run on `rootlco_test_runtime`; the `postgres` admin connection carries
 * BYPASSRLS and only provisions preconditions or reads back what landed.
 *
 * Denial shapes. `check_violation` is 23514; `insufficient_privilege` raised by
 * a function is 42501. A statement that raises aborts its transaction, so every
 * failing probe gets a transaction of its own.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildStorageKey } from '@/modules/shared-services/domain/storage-key';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  withRolledBackTx,
} from './helpers';

type Q = { query: Client['query'] };

const SYS = '00000000-0000-4000-8000-000000000001';

/** A fixture id space no other suite uses. */
const MANAGER_A = 'a0000000-0000-4000-8000-0000000e5001';
const NO_PERM_A = 'a0000000-0000-4000-8000-0000000e5002';
const MANAGER_B = 'b0000000-0000-4000-8000-0000000e5001';
const ROLE_MANAGE_A = 'a0000000-0000-4000-8000-0000000e50c1';
const ROLE_NONE_A = 'a0000000-0000-4000-8000-0000000e50c2';
const ROLE_MANAGE_B = 'b0000000-0000-4000-8000-0000000e50c1';
const CATEGORY_A = 'a0000000-0000-4000-8000-0000000e50d1';
const CATEGORY_B = 'b0000000-0000-4000-8000-0000000e50d1';
const DOC_A = 'a0000000-0000-4000-8000-0000000e50e1';
const DOC_B = 'b0000000-0000-4000-8000-0000000e50e1';

const DOCUMENT_PERMISSION = 'shared.document.manage';
const SCANNER = 'fx_evidence_scanner';

const AS_MANAGER_A = { tenantId: TENANT_A, userId: MANAGER_A };
const AS_NO_PERM_A = { tenantId: TENANT_A, userId: NO_PERM_A };
const AS_MANAGER_B = { tenantId: TENANT_B, userId: MANAGER_B };

let admin: Pool;
let runtime: Pool;

/**
 * Inserts a pending version as ADMIN and returns its id.
 *
 * A precondition, never evidence: `app_runtime` has no INSERT on this table,
 * which is the withholding several assertions below depend on.
 */
async function seedPendingVersion(
  documentId: string = DOC_A,
  tenantId: string = TENANT_A
): Promise<string> {
  const versionId = randomUUID();
  const storageKey = buildStorageKey({
    environment: 'local',
    tenantId,
    documentId,
    versionId,
  });
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(version_number), 0) + 1
                FROM shared.document_versions WHERE tenant_id = $2 AND document_id = $3),
             $4, 'image/png', 2048, decode(repeat('ab', 32), 'hex'), $5, $5)`,
    [versionId, tenantId, documentId, storageKey, tenantId === TENANT_A ? MANAGER_A : MANAGER_B]
  );
  return versionId;
}

const versionRow = async (
  versionId: string
): Promise<
  { status: string; scanning_at: Date | null; quarantined_at: Date | null } | undefined
> => {
  const result = await admin.query<{
    status: string;
    scanning_at: Date | null;
    quarantined_at: Date | null;
  }>(`SELECT status, scanning_at, quarantined_at FROM shared.document_versions WHERE id = $1`, [
    versionId,
  ]);
  return result.rows[0];
};

async function seedFixtures(): Promise<void> {
  for (const table of [
    'shared.document_links',
    'shared.file_scan_results',
    'shared.document_versions',
    'shared.documents',
    'shared.document_categories',
    'iam.role_grants',
    'iam.role_permissions',
    'iam.user_accounts',
    'iam.roles',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
  }

  for (const [id, tenant, code, name] of [
    [ROLE_MANAGE_A, TENANT_A, 'fx_evi_manage', 'Fixture evidence manager A'],
    [ROLE_NONE_A, TENANT_A, 'fx_evi_none', 'Fixture no-permission A'],
    [ROLE_MANAGE_B, TENANT_B, 'fx_evi_manage', 'Fixture evidence manager B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [id, tenant, code, name, SYS]
    );
  }

  for (const [id, tenant, subject, email, name] of [
    [MANAGER_A, TENANT_A, 'fx-evi-mgr-a', 'fx-evi-mgr-a@example.test', 'Fixture manager A'],
    [NO_PERM_A, TENANT_A, 'fx-evi-none-a', 'fx-evi-none-a@example.test', 'Fixture no-permission A'],
    [MANAGER_B, TENANT_B, 'fx-evi-mgr-b', 'fx-evi-mgr-b@example.test', 'Fixture manager B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'test_harness', $3, $4, $5, 'active', $6)`,
      [id, tenant, subject, email, name, SYS]
    );
  }

  // Only the two manager roles map the permission. The "without it" case then
  // differs from the "with it" case in exactly one fact.
  for (const [role, tenant] of [
    [ROLE_MANAGE_A, TENANT_A],
    [ROLE_MANAGE_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4`,
      [tenant, role, SYS, DOCUMENT_PERMISSION]
    );
  }

  for (const [tenant, user, role] of [
    [TENANT_A, MANAGER_A, ROLE_MANAGE_A],
    [TENANT_A, NO_PERM_A, ROLE_NONE_A],
    [TENANT_B, MANAGER_B, ROLE_MANAGE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenant, user, role, SYS]
    );
  }

  for (const [id, tenant] of [
    [CATEGORY_A, TENANT_A],
    [CATEGORY_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1, 'tenant', $2, 'fx_evi_cat', 'Fixture evidence category',
               ARRAY['image/png']::text[], 1048576, 'restricted', 'evidence-audit', $3)`,
      [id, tenant, SYS]
    );
  }

  for (const [id, tenant, category, owner] of [
    [DOC_A, TENANT_A, CATEGORY_A, MANAGER_A],
    [DOC_B, TENANT_B, CATEGORY_B, MANAGER_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.documents
         (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1, $2, $3, 'Fixture evidence document', 'restricted', 'evidence-audit', $4)`,
      [id, tenant, category, owner]
    );
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

beforeEach(async () => {
  await seedFixtures();
});

// ---------------------------------------------------------------------------

describe('the scan handoff is the only way out of pending', () => {
  it('a permitted caller may begin a scan, and the version records when it did', async () => {
    const versionId = await seedPendingVersion();
    const begun = await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      c.query<{ begun: boolean }>('SELECT shared.begin_document_scan($1,$2) AS begun', [
        TENANT_A,
        versionId,
      ])
    );
    expect(begun.rows[0]?.begun).toBe(true);
  });

  it('begin_document_scan refuses a caller without shared.document.manage', async () => {
    const versionId = await seedPendingVersion();
    const result = await withRolledBackTx(runtime, AS_NO_PERM_A, (c: Q) =>
      c.query<{ begun: boolean }>('SELECT shared.begin_document_scan($1,$2) AS begun', [
        TENANT_A,
        versionId,
      ])
    );
    expect(result.rows[0]?.begun).toBe(false);
    expect((await versionRow(versionId))?.status).toBe('pending');
  });

  it('begin_document_scan refuses a version in another tenant, definer rights or not', async () => {
    // The function runs as its definer, so RLS is NOT what stops this. The
    // tenant re-check inside the function is, and that is the point.
    const versionId = await seedPendingVersion();
    const result = await withRolledBackTx(runtime, AS_MANAGER_B, (c: Q) =>
      c.query<{ begun: boolean }>('SELECT shared.begin_document_scan($1,$2) AS begun', [
        TENANT_A,
        versionId,
      ])
    );
    expect(result.rows[0]?.begun).toBe(false);
    expect((await versionRow(versionId))?.status).toBe('pending');
  });

  it('begin_document_scan is not idempotent theatre — a second call finds nothing pending', async () => {
    const versionId = await seedPendingVersion();
    const results = await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      const first = await c.query<{ begun: boolean }>(
        'SELECT shared.begin_document_scan($1,$2) AS begun',
        [TENANT_A, versionId]
      );
      const second = await c.query<{ begun: boolean }>(
        'SELECT shared.begin_document_scan($1,$2) AS begun',
        [TENANT_A, versionId]
      );
      return [first.rows[0]?.begun, second.rows[0]?.begun];
    });
    expect(results).toEqual([true, false]);
  });
});

describe('a scan verdict decides the terminal state, and error never means accept', () => {
  const complete = (
    versionId: string,
    verdict: 'clean' | 'infected' | 'error',
    threat: string | null = null
  ) =>
    withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await c.query('SELECT shared.begin_document_scan($1,$2)', [TENANT_A, versionId]);
      const result = await c.query<{ status: string }>(
        `SELECT shared.complete_document_scan($1,$2,$3,$4,$5,$6::jsonb) AS status`,
        [TENANT_A, versionId, verdict, SCANNER, threat, JSON.stringify({ byte_validation: true })]
      );
      const row = await c.query<{ status: string; quarantined_at: Date | null }>(
        'SELECT status, quarantined_at FROM shared.document_versions WHERE id = $1',
        [versionId]
      );
      return { returned: result.rows[0]?.status, row: row.rows[0] };
    });

  it('a clean verdict accepts', async () => {
    const versionId = await seedPendingVersion();
    const { returned, row } = await complete(versionId, 'clean');
    expect(returned).toBe('accepted');
    expect(row?.status).toBe('accepted');
  });

  it('an infected verdict quarantines and records the threat', async () => {
    const versionId = await seedPendingVersion();
    const { returned, row } = await complete(versionId, 'infected', 'eicar_test_signature');
    expect(returned).toBe('quarantined');
    expect(row?.status).toBe('quarantined');
    expect(row?.quarantined_at).not.toBeNull();
  });

  it('an ERROR verdict quarantines — a scanner that failed never accepts', async () => {
    // The decision states this in one line and it is the line most likely to be
    // "optimised" into a retry that eventually accepts. This is its lock.
    const versionId = await seedPendingVersion();
    const { returned, row } = await complete(versionId, 'error');
    expect(returned).toBe('quarantined');
    expect(row?.status).toBe('quarantined');
  });

  it('refuses a verdict that is not one of the three, rather than defaulting', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await c.query('SELECT shared.begin_document_scan($1,$2)', [TENANT_A, versionId]);
      await expectSqlState(
        c.query(`SELECT shared.complete_document_scan($1,$2,'unknown',$3,NULL,'{}'::jsonb)`, [
          TENANT_A,
          versionId,
          SCANNER,
        ]),
        '23514'
      );
    });
  });

  it('refuses completion on a version that never entered scanning', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      expectSqlState(
        c.query(`SELECT shared.complete_document_scan($1,$2,'clean',$3,NULL,'{}'::jsonb)`, [
          TENANT_A,
          versionId,
          SCANNER,
        ]),
        '42501'
      )
    );
    expect((await versionRow(versionId))?.status).toBe('pending');
  });

  it('refuses completion from another tenant', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      c.query('SELECT shared.begin_document_scan($1,$2)', [TENANT_A, versionId])
    );
    await withRolledBackTx(runtime, AS_MANAGER_B, (c: Q) =>
      expectSqlState(
        c.query(`SELECT shared.complete_document_scan($1,$2,'clean',$3,NULL,'{}'::jsonb)`, [
          TENANT_A,
          versionId,
          SCANNER,
        ]),
        '23514'
      )
    );
  });

  it('refuses a scanner code that is not an identifier, so the record cannot carry free text', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      await c.query('SELECT shared.begin_document_scan($1,$2)', [TENANT_A, versionId]);
      await expectSqlState(
        c.query(
          `SELECT shared.complete_document_scan($1,$2,'clean','Not An Identifier',NULL,'{}'::jsonb)`,
          [TENANT_A, versionId]
        ),
        '23514'
      );
    });
  });
});

/**
 * What the request role may reach directly, and what it still may not.
 *
 * These two cases used to assert that `app_runtime` held NO write grant on
 * either table, which was true while the handoff was `SECURITY DEFINER`. That
 * implementation was withdrawn: four repository-wide gates assert that every
 * module routine is `SECURITY INVOKER` with an empty `search_path` and none of
 * them carries an allow-list, so keeping the elevation would have meant
 * weakening four security gates to admit one migration.
 *
 * The replacement is a COLUMN grant — `UPDATE(status)` and `INSERT` — under RLS,
 * with the lifecycle trigger unchanged. So the honest question is no longer
 * "can the role write at all" but "what are the BOUNDS of what it can write",
 * and that is what these cases now hold. Deleting them and trusting the grant
 * would have been the half-update this suite exists to catch.
 */
describe('the narrow grants are narrow — bounds, not absence', () => {
  it('writes STATUS only: no other column of a version is reachable', async () => {
    /*
     * The load-bearing property of a column grant, and the reason it is
     * preferable to an elevated function whose body could later be widened.
     * A version's bytes, its checksum and its storage key are what make it
     * evidence; none of them is writable at any status, by any statement.
     */
    const versionId = await seedPendingVersion();
    for (const column of ['sha256', 'size_bytes', 'content_type', 'storage_key']) {
      await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
        expectSqlState(
          c.query(`UPDATE shared.document_versions SET ${column} = $2 WHERE id = $1`, [
            versionId,
            column === 'size_bytes' ? 1 : 'x',
          ]),
          '42501'
        )
      );
    }
  });

  it('cannot skip the scan: pending may not reach accepted directly', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [versionId]),
        '23514'
      )
    );
    expect((await versionRow(versionId))?.status).toBe('pending');
  });

  it('cannot self-certify: scanning may not reach accepted without a clean scan', async () => {
    const versionId = await seedPendingVersion();
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
      versionId,
    ]);
    await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [versionId]),
        '23514'
      )
    );
  });

  it('cannot reopen a terminal version, so evidence cannot be un-accepted', async () => {
    const versionId = await seedPendingVersion();
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
      versionId,
    ]);
    await admin.query(`UPDATE shared.document_versions SET status='rejected' WHERE id=$1`, [
      versionId,
    ]);
    await withRolledBackTx(runtime, AS_MANAGER_A, async (c: Q) => {
      // The row is outside the write policy's USING clause once terminal, so it
      // is filtered to zero rows rather than refused — either is correct, and
      // succeeding is not.
      const result = await c
        .query(`UPDATE shared.document_versions SET status='pending' WHERE id=$1`, [versionId])
        .catch((error: unknown) => error as { code?: string });
      if ('code' in result && result.code !== undefined) {
        expect(['42501', '23514']).toContain(result.code);
      } else {
        expect((result as { rowCount: number }).rowCount).toBe(0);
      }
    });
    expect((await versionRow(versionId))?.status).toBe('rejected');
  });

  it('cannot record a scan result against another tenant, grant or no grant', async () => {
    const versionId = await seedPendingVersion();
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
      versionId,
    ]);
    await withRolledBackTx(runtime, AS_MANAGER_B, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1,$2,'clean',$3,$4)`,
          [TENANT_A, versionId, SCANNER, MANAGER_B]
        ),
        '42501'
      )
    );
  });

  it('cannot record a scan result for a version that never entered scanning', async () => {
    const versionId = await seedPendingVersion();
    await withRolledBackTx(runtime, AS_MANAGER_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results
             (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1,$2,'clean',$3,$4)`,
          [TENANT_A, versionId, SCANNER, MANAGER_A]
        ),
        '42501'
      )
    );
  });

  it('holds no DELETE on either table, so a verdict cannot be withdrawn', async () => {
    const { rows } = await admin.query<{ privilege_type: string; table_name: string }>(
      `SELECT table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime'
          AND table_schema = 'shared'
          AND table_name IN ('document_versions', 'file_scan_results')
          AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`
    );
    expect(rows).toEqual([]);
  });

  it('both scan functions are revoked from PUBLIC and granted only to app_runtime', async () => {
    const { rows } = await admin.query<{ proname: string; acl: string }>(
      `SELECT p.proname, COALESCE(array_to_string(p.proacl, ','), '') AS acl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared'
          AND p.proname IN ('begin_document_scan', 'complete_document_scan')
        ORDER BY p.proname`
    );
    expect(rows.map((row) => row.proname)).toEqual([
      'begin_document_scan',
      'complete_document_scan',
    ]);
    for (const row of rows) {
      expect(row.acl, row.proname).toContain('app_runtime=X');
      // `=X/` with an empty grantee is the PUBLIC entry.
      expect(row.acl, row.proname).not.toMatch(/(^|,)=X\//);
    }
  });

  it('both scan functions pin an empty search_path, so no schema can be shadowed', async () => {
    const { rows } = await admin.query<{ proname: string; config: string[] | null }>(
      `SELECT p.proname, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared'
          AND p.proname IN ('begin_document_scan', 'complete_document_scan')`
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // PostgreSQL stores `SET search_path = ''` as the entry `search_path=""`,
      // so this is a prefix test, not an equality test — asserting the literal
      // `search_path=` would fail against a correctly pinned function.
      expect(
        (row.config ?? []).some((entry) => entry.startsWith('search_path=')),
        row.proname
      ).toBe(true);
    }
  });
});

describe('the category policy is server-side data, not a client preference', () => {
  it('carries the two policy columns with a constrained link purpose', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='shared' AND table_name='document_categories'
          AND column_name IN ('business_link_purpose','device_capture_timestamp_required')
        ORDER BY column_name`
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'business_link_purpose',
      'device_capture_timestamp_required',
    ]);

    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
              default_classification, default_retention_class, business_link_purpose, created_by)
           VALUES ('tenant', $1, 'fx_evi_bad', 'Fixture bad purpose',
                   ARRAY['image/png']::text[], 1024, 'internal', 'operational', 'whatever', $2)`,
          [TENANT_A, SYS]
        ),
        '23514'
      )
    );
  });

  it('the seeded reception categories require a device capture timestamp', async () => {
    const { rows } = await admin.query<{
      category_code: string;
      device_capture_timestamp_required: boolean;
      business_link_purpose: string;
      allowed_content_types: string[];
    }>(
      `SELECT category_code, device_capture_timestamp_required, business_link_purpose,
              allowed_content_types
         FROM shared.document_categories
        WHERE scope='platform' AND category_code LIKE 'reception\\_%'
        ORDER BY category_code`
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      // Every content type a reception category accepts is one the byte-level
      // validator can actually decode. A category that permitted a type nothing
      // can decode would quarantine every upload made against it.
      for (const contentType of row.allowed_content_types) {
        expect(['image/jpeg', 'image/png', 'image/webp'], row.category_code).toContain(contentType);
      }
      expect(
        ['evidence', 'identity_document', 'inspection_media', 'signature'],
        row.category_code
      ).toContain(row.business_link_purpose);
    }
    // The capture requirement is the one a client would most like to skip.
    const captureRequired = rows.filter((row) => row.device_capture_timestamp_required);
    expect(captureRequired.length).toBeGreaterThanOrEqual(6);
  });

  it('a version records the device capture instant it was registered with', async () => {
    const versionId = await seedPendingVersion();
    const captured = new Date('2026-08-15T09:30:00.000Z');
    await admin.query(`UPDATE shared.document_versions SET captured_at = $2 WHERE id = $1`, [
      versionId,
      captured,
    ]);
    const { rows } = await admin.query<{ captured_at: Date }>(
      `SELECT captured_at FROM shared.document_versions WHERE id = $1`,
      [versionId]
    );
    expect(rows[0]?.captured_at?.toISOString()).toBe(captured.toISOString());
  });
});

describe('replacement creates a new version and never overwrites the prior one', () => {
  it('a second version leaves the first byte-for-byte untouched', async () => {
    const first = await seedPendingVersion();
    // Accepted as ADMIN: this test is about what a REPLACEMENT does to an
    // accepted version, so the acceptance is a precondition and needs to be
    // durable rather than rolled back with the transaction that produced it.
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [first]);
    await admin.query(
      `INSERT INTO shared.file_scan_results
         (tenant_id, version_id, scan_status, scanner_code, created_by)
       VALUES ($1,$2,'clean',$3,$4)`,
      [TENANT_A, first, SCANNER, MANAGER_A]
    );
    await admin.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [first]);

    const before = await admin.query<{
      storage_key: string;
      sha256: Buffer;
      status: string;
      version_number: number;
    }>(
      `SELECT storage_key, sha256, status, version_number
         FROM shared.document_versions WHERE id = $1`,
      [first]
    );

    const second = await seedPendingVersion();

    const after = await admin.query<{
      storage_key: string;
      sha256: Buffer;
      status: string;
      version_number: number;
    }>(
      `SELECT storage_key, sha256, status, version_number
         FROM shared.document_versions WHERE id = $1`,
      [first]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    const replacement = await admin.query<{ version_number: number; storage_key: string }>(
      `SELECT version_number, storage_key FROM shared.document_versions WHERE id = $1`,
      [second]
    );
    // A distinct version number AND a distinct object: the replacement cannot
    // land on the bytes the accepted version is evidence of.
    expect(replacement.rows[0]?.version_number).toBe((before.rows[0]?.version_number ?? 0) + 1);
    expect(replacement.rows[0]?.storage_key).not.toBe(before.rows[0]?.storage_key);
  });

  it('two versions of one document cannot share a version number', async () => {
    await seedPendingVersion();
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_versions
             (tenant_id, document_id, version_number, storage_key, content_type,
              size_bytes, sha256, uploaded_by, created_by)
           VALUES ($1,$2,1,'local/fx/collision','image/png',10,decode(repeat('cd',32),'hex'),$3,$3)`,
          [TENANT_A, DOC_A, MANAGER_A]
        ),
        '23505'
      )
    );
  });
});

/**
 * The privilege surface, DERIVED from the shipped write rather than restated.
 *
 * `shared.attachment-version-register` answered HTTP 500 to every request with
 * `permission denied for table document_versions`, because `captured_at` was
 * added by this migration and `app_runtime` holds INSERT on this table COLUMN BY
 * COLUMN — adding a column grants nothing on it, and the statement names it.
 *
 * A published operation that fails every call is the P1-27-INT-113 shape, and it
 * survived a 1681-test database tier because no DB case drives the HTTP path.
 * So the guard here is not another hand-kept list of columns — a second list is
 * exactly what drifted. The expected set is PARSED from the repository's own
 * INSERT statement, so a column added to the write tomorrow is compared against
 * the grants tomorrow, with nobody remembering to update anything.
 */
describe('document_versions INSERT grants cover exactly what the service writes', () => {
  const REPOSITORY = fileURLToPath(
    new URL(
      '../../apps/api/src/modules/shared-services/data/document-repository.ts',
      import.meta.url
    )
  );

  const GRANTED = async (privilege: string): Promise<Set<string>> => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.role_column_grants
        WHERE grantee = 'app_runtime' AND table_schema = 'shared'
          AND table_name = 'document_versions' AND privilege_type = $1`,
      [privilege]
    );
    return new Set(rows.map((row) => row.column_name));
  };

  /** The columns the shipped INSERT names, read from the source that ships. */
  function writtenColumns(): readonly string[] {
    const source = readFileSync(REPOSITORY, 'utf8');
    const match = /INSERT INTO shared\.document_versions\s*\(([\s\S]*?)\)\s*VALUES/.exec(source);
    const columnList = match?.[1];
    // Guarded rather than asserted-then-cast: this tier compiles under
    // `noUncheckedIndexedAccess`, and a cast here would hide the one case that
    // matters — the parse silently returning nothing.
    expect(columnList, 'the repository no longer contains a document_versions INSERT').toBeTruthy();
    return String(columnList)
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .sort();
  }

  it('parses a real write-set — an empty parse would make every check below vacuous', () => {
    const columns = writtenColumns();
    expect(columns.length).toBeGreaterThan(8);
    // The column whose absence caused the outage, named so a silent parse
    // regression cannot quietly drop it.
    expect(columns).toContain('captured_at');
  });

  it('every column the service writes is granted to app_runtime', async () => {
    const granted = await GRANTED('INSERT');
    const missing = writtenColumns().filter((column) => !granted.has(column));
    expect(
      missing,
      `the registration INSERT names column(s) app_runtime cannot write: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('grants nothing the service does not write — the lifecycle stamps stay server-owned', async () => {
    /*
     * The other direction, and the reason this is not simply "grant everything".
     * `scanning_at`, `accepted_at`, `quarantined_at` and `rejected_at` are set by
     * `guard_document_version_transition`, never by a caller. A trigger assigning
     * NEW.<column> needs no column privilege, so granting these would widen the
     * surface for no caller at all — and would let a request write a lifecycle
     * timestamp the database is supposed to own.
     */
    const granted = await GRANTED('INSERT');
    for (const serverOwned of ['scanning_at', 'accepted_at', 'quarantined_at', 'rejected_at']) {
      expect(granted.has(serverOwned), `${serverOwned} must stay server-owned`).toBe(false);
    }
    // And UPDATE remains exactly the one column the scan handoff moves.
    expect([...(await GRANTED('UPDATE'))]).toEqual(['status']);
  });
});
