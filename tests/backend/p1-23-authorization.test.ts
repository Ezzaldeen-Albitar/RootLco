/**
 * P1-23 authorization — the POSITIVE direction.
 *
 * ## Why this file exists
 *
 * The three P1-23 evidence suites each assert that an unpermitted principal is
 * refused. Every one of those assertions passed while all four of this phase's
 * new permission codes were MISSING FROM THE PLATFORM CATALOG — because a
 * permission that does not exist cannot be held by anybody, so "this principal
 * is refused" was true for a reason that had nothing to do with authorization
 * working. A denial-only suite cannot tell a guard that works from a guard that
 * refuses everyone.
 *
 * So this file asserts the direction that fails when a code is absent: a
 * principal who HOLDS the permission is ALLOWED. It grants each phase permission
 * to a dedicated role, grants that role to a real user, and requires the
 * operation to succeed. If a permission code is dropped from
 * `supabase/seeds/04_iam_permission_catalog.sql`, the grant below inserts zero
 * rows and the operation is refused — and this suite goes red, where the denial
 * suites would all stay green.
 *
 * The role is created and destroyed by this file rather than reusing the shared
 * allow-role, so widening it cannot silently widen another suite's fixture.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.notification-list   shared.notification-read
 *   shared.notification-delivery-list   shared.document-read
 *   shared.document-retention-evaluate  rpt.report-catalogue  rpt.report-read
 *
 * COVERAGE-EVIDENCE (P1-23 positive authorization):
 *   shared.notification-list: authorization
 *   shared.notification-read: authorization
 *   shared.notification-delivery-list: authorization
 *   shared.document-read: authorization
 *   shared.document-retention-evaluate: authorization
 *   rpt.report-catalogue: authorization
 *   rpt.report-read: authorization
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  TENANT_A,
  USER_A,
  USER_PERMITTED,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';

let admin: Pool;
let runtime: Pool;

const ROLE_P1_23 = '0e000000-0000-4000-8000-000000000023';

/**
 * Every permission this phase's operations declare. Kept as a literal rather
 * than derived from the operations, so that deleting a `permissions:` entry
 * from a route shows up as a failing assertion instead of quietly shrinking the
 * list this file checks.
 */
const PHASE_PERMISSIONS = [
  'shared.notification.read',
  'shared.notification.delivery.read',
  'shared.document.manage',
  'shared.document.archive',
  'rpt.report.read',
] as const;

async function phaseOperations() {
  const [notifications, notification, deliveries, document, retention, reports, report] =
    await Promise.all([
      import('@/app/api/v1/notifications/route'),
      import('@/app/api/v1/notifications/[notificationId]/route'),
      import('@/app/api/v1/notifications/[notificationId]/deliveries/route'),
      import('@/app/api/v1/attachments/documents/[documentId]/route'),
      import('@/app/api/v1/attachments/documents/[documentId]/retention-evaluations/route'),
      import('@/app/api/v1/reports/route'),
      import('@/app/api/v1/reports/[reportCode]/route'),
    ]);
  return [
    notifications.NOTIFICATION_LIST_OPERATION,
    notification.NOTIFICATION_READ_OPERATION,
    deliveries.NOTIFICATION_DELIVERY_LIST_OPERATION,
    document.DOCUMENT_READ_OPERATION,
    retention.DOCUMENT_RETENTION_EVALUATE_OPERATION,
    reports.REPORT_CATALOGUE_OPERATION,
    report.REPORT_READ_OPERATION,
  ];
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_23_reader', 'P1-23 reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_P1_23, TENANT_A, USER_A]
  );

  // Resolved from the CATALOG by code. If a code is absent this inserts nothing,
  // which is exactly the failure this suite exists to surface.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $4::uuid
       FROM iam.permissions p
      WHERE p.permission_code = ANY($3::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_P1_23, [...PHASE_PERMISSIONS], USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, USER_PERMITTED, ROLE_P1_23, USER_A]
  );
});

afterAll(async () => {
  await admin.query(`DELETE FROM iam.role_grants WHERE tenant_id = $1 AND role_id = $2`, [
    TENANT_A,
    ROLE_P1_23,
  ]);
  await admin.query(`DELETE FROM iam.role_permissions WHERE tenant_id = $1 AND role_id = $2`, [
    TENANT_A,
    ROLE_P1_23,
  ]);
  await admin.query(`DELETE FROM iam.roles WHERE id = $1`, [ROLE_P1_23]);
  await cleanBackendFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('P1-23 permission catalog', () => {
  it('seeds every permission this phase declares', async () => {
    const { rows } = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions WHERE permission_code = ANY($1::text[])`,
      [[...PHASE_PERMISSIONS]]
    );
    const seeded = rows.map((r) => r.permission_code).sort();

    // The assertion that was missing. Four of these five were absent, and every
    // denial test in the phase still passed.
    expect(seeded).toEqual([...PHASE_PERMISSIONS].sort());
  });

  it('grants the phase role every one of them', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.tenant_id = $1 AND rp.role_id = $2 AND rp.effect = 'allow'
          AND p.permission_code = ANY($3::text[])`,
      [TENANT_A, ROLE_P1_23, [...PHASE_PERMISSIONS]]
    );
    // A grant that resolved zero rows would leave every allow-case below passing
    // for the wrong reason, so the count is asserted rather than assumed.
    expect(Number(rows[0]?.n)).toBe(PHASE_PERMISSIONS.length);
  });
});

describe('P1-23 authorization — a holder is allowed', () => {
  it('permits every phase operation for a principal holding its permissions', async () => {
    const operations = await phaseOperations();
    expect(operations).toHaveLength(7);

    for (const operation of operations) {
      const outcome = await withTransaction(
        contextFor({ tenantId: TENANT_A, userId: USER_PERMITTED, operation: operation.id }),
        (db) =>
          requirePermissions(db, operation)
            .then(() => 'allowed' as const)
            .catch((error: unknown) => error)
      );
      expect(outcome, `${operation.id} must permit a principal holding its permissions`).toBe(
        'allowed'
      );
    }
  });

  it('still refuses the same operations for a principal holding none', async () => {
    // The negative direction, kept alongside the positive one: together they say
    // the guard discriminates. Either alone can pass while authorization is broken.
    const operations = await phaseOperations();

    for (const operation of operations) {
      const outcome = await withTransaction(
        contextFor({ tenantId: TENANT_A, userId: USER_UNPERMITTED, operation: operation.id }),
        (db) =>
          requirePermissions(db, operation)
            .then(() => null)
            .catch((error: unknown) => error)
      );
      expect(outcome, `${operation.id} must refuse an unpermitted principal`).toBeInstanceOf(
        AppFailure
      );
    }
  });
});
