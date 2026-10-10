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
 * Nothing here executes a report. P1-23 shipped `executable` as the literal
 * `false`, because the frozen schema bound no data source to a report code;
 * P1-31 P-11 made it REGISTRY MEMBERSHIP instead. Both of this phase's
 * properties outlived that change and are pinned here in their new places:
 *
 *   * a definition whose code the engine implements nothing for still reads
 *     `executable: false`, so a client is never offered a run that cannot
 *     happen;
 *   * an unpublished configuration is refused at the point a run would apply
 *     it. The by-code read no longer filters on status — the restriction has to
 *     be SEEN before it can be refused, or a draft would fall back to the
 *     code-registered baseline and become runnable — so the refusal lives in
 *     `assertReportConfiguration`, and that is where this file pins it.
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
  BRANCH_A1,
  COMPANY_A1,
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
import { isReportDatasetCode, reportDataset, reportingModule } from '@/modules/reporting';
// Two internal imports, and they are the point rather than a shortcut: the
// property below is about what the by-code READ returns and what the POLICY then
// does with it, and neither is observable through a service that refuses before
// either is reached. The module's public surface exports no repository, on
// purpose; a test reaching past it runs SQL under the module's identity and must
// assert nothing about authorization, which this one does not.
import { assertReportConfiguration } from '@/modules/reporting/application/report-configuration-policy';
import { ReportCatalogueRepository } from '@/modules/reporting/data/report-catalogue-repository';

let admin: Pool;
let runtime: Pool;

const PUBLISHED = 'p1_23_published';
const DRAFT = 'p1_23_draft';
const ARCHIVED = 'p1_23_archived';
const FOREIGN = 'p1_23_foreign';
/**
 * A code the ENGINE implements, configured by this tenant and not published.
 *
 * The code has to be a registered one: an unregistered code is refused before
 * any configuration is read, so a draft under one could not express the property
 * at all. Every other fixture here deliberately uses a code the engine does not
 * implement, which is what makes `executable: false` observable.
 */
const REGISTERED_DRAFT = 'work_orders_by_status';

async function seedReport(input: {
  readonly tenantId: string;
  readonly code: string;
  readonly status: string;
  readonly withPublishedVersion: boolean;
  readonly parameterSchema?: unknown;
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
      [
        input.tenantId,
        id,
        JSON.stringify(input.parameterSchema ?? { filters: { branchId: { type: 'uuid' } } }),
        owner,
      ]
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
  await seedReport({
    tenantId: TENANT_A,
    code: REGISTERED_DRAFT,
    status: 'draft',
    // A published VERSION under an unpublished configuration. That combination
    // is what separates the two reasons a run can be refused: without a version
    // the refusal could be "nothing has been published yet" rather than "this
    // configuration is not published".
    withPublishedVersion: true,
    // `{}` is the column's own default and places no restriction, so nothing
    // downstream of the publication test can refuse this row for a second
    // reason.
    parameterSchema: {},
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
    // The same holds for a code the engine DOES implement: an unpublished
    // configuration is not listed, and it suppresses the code-registered
    // baseline rather than letting the platform entry stand in for a decision
    // this tenant has not taken.
    expect(codes).not.toContain(REGISTERED_DRAFT);
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

  it('projects the per-report export permission and claims executability only for a registered code', async () => {
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-catalogue' }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );
    const report = result.items.find((r) => r.reportCode === PUBLISHED);
    expect(report?.exportPermissionCode).toBe('rpt.export');
    // P1-23 answered `false` for every definition because the frozen schema
    // bound no data source to a report code. P1-31 P-11 made the answer registry
    // membership, and this tenant definition is exactly the case that must not
    // move: a published row whose code the engine implements nothing for. A
    // client offered a run for it would be offered one that cannot happen.
    expect(isReportDatasetCode(PUBLISHED)).toBe(false);
    expect(report?.executable).toBe(false);
    // The rule, not one row: every tenant-authored entry states its own code's
    // registration and nothing else.
    for (const item of result.items.filter((entry) => entry.source === 'tenant')) {
      expect(item.executable, item.reportCode).toBe(isReportDatasetCode(item.reportCode));
    }
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
    ['a draft under a code the engine implements', REGISTERED_DRAFT],
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

describe('P1-23 reporting — the configuration gate', () => {
  it('never applies a configuration the tenant has not published', async () => {
    const refusal = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_A, operation: 'rpt.report-read' }),
      async (db) => {
        const row = await new ReportCatalogueRepository().findByCode(db, REGISTERED_DRAFT);
        // The read returns the row WHATEVER its status, and that is deliberate:
        // a read that hid a draft would leave the code looking unconfigured, the
        // platform baseline would answer for it, and an unpublished decision
        // would become runnable. Seeing the restriction is what allows refusing
        // it.
        expect(row?.status).toBe('draft');
        expect(row?.version_number).toBe(1);
        try {
          assertReportConfiguration(row, reportDataset(REGISTERED_DRAFT), {
            companyId: COMPANY_A1,
            branchId: BRANCH_A1,
            from: '2027-03-01',
            to: '2027-03-08',
          });
          return null;
        } catch (error: unknown) {
          return error;
        }
      }
    );

    // The same answer the catalogue gives for the same row, and for the same
    // reason: which codes a tenant has configured is not something a refusal may
    // disclose.
    expect(refusal, 'an unpublished configuration must never be applied').toBeInstanceOf(
      AppFailure
    );
    expect((refusal as AppFailure).code).toBe('ERR-RES-001');
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
