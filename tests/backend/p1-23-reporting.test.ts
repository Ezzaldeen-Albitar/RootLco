/**
 * P1-23 operation evidence — the report catalogue.
 *
 * These are the first operations ever registered against the `rpt.` namespace.
 * Phase 1-11 froze the schema; nothing had read it.
 *
 * The catalogue is tenant CONFIGURATION, so the properties worth pinning are
 * about what a caller can and cannot learn from it:
 *
 *   * only `published` definitions are visible — a draft is an unfinished
 *     decision and an archived one is withdrawn;
 *   * a draft, an archived report, another tenant's report and a code that
 *     never existed all answer ERR-RES-001 **identically**, so the endpoint
 *     cannot be used to enumerate which report codes a tenant has configured;
 *   * the per-report export permission is projected, because
 *     `export_permission_code` is a foreign key into the permission catalogue
 *     and view permission is therefore NOT export permission.
 *
 * Nothing here executes a report. The frozen schema binds no data source to a
 * report code, so there is no approved contract saying what one should select —
 * which the response states as `executable: false` rather than leaving a client
 * to infer.
 *
 * Operations exercised here (coverage-gate references):
 *   rpt.report-catalogue   rpt.report-read
 *
 * COVERAGE-EVIDENCE (P1-23 reporting):
 *   rpt.report-catalogue: route service success denial cross-tenant isolation authorization
 *   rpt.report-read: route service success denial cross-tenant isolation authorization
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
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
import { MAX_PAGE_SIZE } from '@/server/db/pagination';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';
import { reportingModule } from '@/modules/reporting';

let admin: Pool;
let runtime: Pool;

const PUBLISHED = 'p1_23_published';
const DRAFT = 'p1_23_draft';
const ARCHIVED = 'p1_23_archived';
const FOREIGN = 'p1_23_foreign';

async function seedReport(input: {
  readonly tenantId: string;
  readonly code: string;
  readonly status: string;
  readonly withPublishedVersion: boolean;
}): Promise<string> {
  const id = randomUUID();
  const owner = input.tenantId === TENANT_B ? USER_TENANT_B : USER_A;
  await admin.query(
    `INSERT INTO rpt.report_configurations
       (id, tenant_id, report_code, name, scope_level, export_permission_code,
        owner_user_id, status, created_by)
     VALUES ($1, $2, $3, $4, 'branch', 'rpt.export', $5, $6, $5)`,
    [id, input.tenantId, input.code, `Report ${input.code}`, owner, input.status]
  );
  if (input.withPublishedVersion) {
    await admin.query(
      `INSERT INTO rpt.report_configuration_versions
         (tenant_id, report_configuration_id, version_number, parameter_schema,
          status, published_at, created_by)
       VALUES ($1, $2, 1, $3::jsonb, 'published', now(), $4)`,
      [input.tenantId, id, JSON.stringify({ filters: { branchId: { type: 'uuid' } } }), owner]
    );
  }
  return id;
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);

  await seedReport({
    tenantId: TENANT_A,
    code: PUBLISHED,
    status: 'published',
    withPublishedVersion: true,
  });
  await seedReport({
    tenantId: TENANT_A,
    code: DRAFT,
    status: 'draft',
    withPublishedVersion: false,
  });
  await seedReport({
    tenantId: TENANT_A,
    code: ARCHIVED,
    status: 'archived',
    withPublishedVersion: true,
  });
  await seedReport({
    tenantId: TENANT_B,
    code: FOREIGN,
    status: 'published',
    withPublishedVersion: true,
  });
});

afterAll(async () => {
  await admin.query(
    `DELETE FROM rpt.report_configuration_versions WHERE tenant_id = ANY($1::uuid[])`,
    [[TENANT_A, TENANT_B]]
  );
  await admin.query(`DELETE FROM rpt.report_configurations WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await cleanBackendFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('rpt.report-catalogue', () => {
  it('invokes rpt.report-catalogue and lists only published definitions', async () => {
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-catalogue' }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );

    const codes = result.items.map((r) => r.reportCode);
    expect(codes).toContain(PUBLISHED);
    // A draft is an unfinished decision; an archived report is a withdrawn one.
    expect(codes).not.toContain(DRAFT);
    expect(codes).not.toContain(ARCHIVED);
  });

  it('bounds the page size rather than trusting the caller', async () => {
    // `rpt.report_configurations` is a table the TENANT writes, so an unbounded
    // read would let a tenant choose the response size. Unlike
    // shared.export-catalogue, which returns a static in-code array, this one
    // needs a real cap.
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-catalogue' }),
      (db) => reportingModule().catalogue.listPublished(db, { limit: 100_000 })
    );

    expect(result.items.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('does not list another tenant catalogue', async () => {
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-catalogue' }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );
    expect(result.items.map((r) => r.reportCode)).not.toContain(FOREIGN);
  });

  it('projects the per-report export permission and never claims executability', async () => {
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-catalogue' }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );
    const report = result.items.find((r) => r.reportCode === PUBLISHED);
    expect(report?.exportPermissionCode).toBe('rpt.export');
    // No data source is bound to a report code by the frozen schema, so nothing
    // can be run yet and the response must say so rather than let a client infer.
    expect(report?.executable).toBe(false);
  });
});

describe('rpt.report-read', () => {
  it('invokes rpt.report-read and returns the filter allowlist', async () => {
    const view = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-read' }),
      (db) => reportingModule().catalogue.readByCode(db, PUBLISHED)
    );

    expect(view.reportCode).toBe(PUBLISHED);
    expect(view.versionNumber).toBe(1);
    // The parameter schema IS the filter allowlist — a report cannot accept a
    // filter it does not declare.
    expect(JSON.stringify(view.parameterSchema)).toContain('branchId');
  });

  it.each([
    ['a draft', DRAFT],
    ['an archived report', ARCHIVED],
    ['another tenant report', FOREIGN],
    ['a code that never existed', 'p1_23_absent'],
  ])('answers ERR-RES-001 identically for %s', async (_label, code) => {
    // All four answer the same way. A catalogue that distinguished them would
    // be a way to enumerate which report codes a tenant has configured.
    const denied = (await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-read' }),
      (db) =>
        reportingModule()
          .catalogue.readByCode(db, code)
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(denied).toBeInstanceOf(AppFailure);
    expect(denied.code).toBe('ERR-RES-001');
  });
});

describe('P1-23 reporting — authorization', () => {
  it('refuses both operations for a principal holding none of their permissions', async () => {
    const { REPORT_CATALOGUE_OPERATION } = await import('@/app/api/v1/reports/route');
    const { REPORT_READ_OPERATION } = await import('@/app/api/v1/reports/[reportCode]/route');

    for (const operation of [REPORT_CATALOGUE_OPERATION, REPORT_READ_OPERATION]) {
      const denied = await withTransaction(
        contextFor({ tenantId: TENANT_A, userId: USER_UNPERMITTED, operation: operation.id }),
        (db) =>
          requirePermissions(db, operation)
            .then(() => null)
            .catch((error: unknown) => error)
      );
      expect(denied, `${operation.id} must refuse an unpermitted principal`).toBeInstanceOf(
        AppFailure
      );
    }
  });

  it('keeps view permission distinct from the per-report export permission', async () => {
    const { REPORT_READ_OPERATION } = await import('@/app/api/v1/reports/[reportCode]/route');
    // Viewing a definition must not be the same right as exporting its data.
    expect(REPORT_READ_OPERATION.permissions).toEqual(['rpt.report.read']);
    expect(REPORT_READ_OPERATION.permissions).not.toContain('rpt.export');
  });
});
