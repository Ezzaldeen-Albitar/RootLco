import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportRunService } from '@api/modules/reporting/application/report-run-service';
import { ReportCatalogueService } from '@api/modules/reporting/application/report-catalogue-service';
import type {
  ReportCatalogueRepository,
  ReportConfigurationRow,
} from '@api/modules/reporting/data/report-catalogue-repository';
import { assertReportConfiguration } from '@api/modules/reporting/application/report-configuration-policy';
import { reportDataset } from '@api/modules/reporting/domain/report-datasets';

const calls = vi.hoisted(() => ({
  permission: vi.fn(),
  branch: vi.fn(),
  dataset: vi.fn(),
}));
vi.mock('@/server/auth/authorization', () => ({ callerHoldsPermission: calls.permission }));
vi.mock('@/modules/iam', () => ({
  iamOrganizationContext: () => ({ branches: { findBranch: calls.branch } }),
}));
vi.mock('@/modules/work-order', () => ({
  workOrderModule: () => ({ reportPort: { statusSummary: calls.dataset } }),
}));

const db = {} as never;
const input = {
  reportCode: 'work_orders_by_status',
  companyId: 'a1310000-0000-4000-8000-000000000001',
  branchId: 'a1310000-0000-4000-8000-000000000002',
  from: '2027-03-02',
  to: '2027-03-04',
};
const allowedFilters = {
  companyId: { type: 'uuid' },
  branchId: { type: 'uuid' },
  from: { type: 'date' },
  to: { type: 'date' },
};
function configuration(overrides: Partial<ReportConfigurationRow> = {}): ReportConfigurationRow {
  return {
    id: 'a1310000-0000-4000-8000-000000000003',
    report_code: input.reportCode,
    name: 'Configured work order report',
    scope_level: 'branch',
    export_permission_code: 'rpt.export',
    status: 'published',
    record_version: 1,
    version_number: 1,
    parameter_schema: { filters: allowedFilters },
    published_at: new Date('2026-09-10T00:00:00Z'),
    ...overrides,
  };
}
function repository(row: ReportConfigurationRow | null): ReportCatalogueRepository {
  return {
    findByCode: vi.fn().mockResolvedValue(row),
    findByCodes: vi.fn().mockResolvedValue(row === null ? [] : [row]),
    listPublished: vi.fn().mockResolvedValue({
      items: row?.status === 'published' ? [row] : [],
      nextCursor: null,
      hasMore: false,
    }),
  } as unknown as ReportCatalogueRepository;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.permission.mockResolvedValue(true);
  calls.branch.mockResolvedValue({ name: 'Reported branch', timezoneName: 'Asia/Amman' });
  calls.dataset.mockResolvedValue({
    counts: [],
    workOrders: { items: [], nextCursor: null, hasMore: false },
  });
});

describe('registered report controls before the dataset read', () => {
  it('runs without a configuration while checking dataset permission in the selected branch', async () => {
    const result = await new ReportRunService(repository(null)).run(db, input);
    expect(result.reportCode).toBe(input.reportCode);
    expect(calls.permission).toHaveBeenCalledWith(db, 'wo.work_order.read', {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    expect(calls.dataset).toHaveBeenCalledOnce();
  });

  it('refuses a missing scoped dataset permission before configuration or dataset reads', async () => {
    calls.permission.mockResolvedValue(false);
    const repo = repository(null);
    await expect(new ReportRunService(repo).run(db, input)).rejects.toMatchObject({
      code: 'ERR-IAM-001',
    });
    expect(repo.findByCode).not.toHaveBeenCalled();
    expect(calls.branch).not.toHaveBeenCalled();
    expect(calls.dataset).not.toHaveBeenCalled();
  });

  it('accepts the published filter allowlist without widening dataset scope or requiring export to read', async () => {
    await new ReportRunService(repository(configuration())).run(db, { ...input, limit: 2 });
    expect(calls.permission.mock.calls.map((call) => call[1])).toEqual(['wo.work_order.read']);
    expect(calls.dataset).toHaveBeenCalledOnce();
    expect(calls.dataset.mock.calls[0]?.[1]).toMatchObject({
      companyId: input.companyId,
      branchId: input.branchId,
    });
  });

  it.each([
    ['draft', configuration({ status: 'draft' }), 'ERR-RES-001'],
    ['archived', configuration({ status: 'archived' }), 'ERR-RES-001'],
    ['no live published version', configuration({ version_number: null }), 'ERR-RES-001'],
    [
      'narrow filter allowlist',
      configuration({ parameter_schema: { filters: { branchId: { type: 'uuid' } } } }),
      'ERR-IAM-001',
    ],
    [
      'unknown explicit constraint',
      configuration({
        parameter_schema: {
          filters: { ...allowedFilters, branchId: { type: 'uuid', enum: [input.branchId] } },
        },
      }),
      'ERR-IAM-001',
    ],
    ['unrecognized schema', configuration({ parameter_schema: { parameters: [] } }), 'ERR-IAM-001'],
    [
      'explicit empty filter allowlist',
      configuration({ parameter_schema: { filters: {} } }),
      'ERR-IAM-001',
    ],
  ])('refuses %s before reading branch or dataset', async (_name, row, code) => {
    await expect(new ReportRunService(repository(row)).run(db, input)).rejects.toMatchObject({
      code,
    });
    expect(calls.branch).not.toHaveBeenCalled();
    expect(calls.dataset).not.toHaveBeenCalled();
  });

  it('accepts the schema default {} as no additional filter restriction', async () => {
    await new ReportRunService(repository(configuration({ parameter_schema: {} }))).run(db, input);
    expect(calls.permission).toHaveBeenCalledWith(db, 'wo.work_order.read', {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    expect(calls.dataset).toHaveBeenCalledOnce();
  });

  it('enforces the configured scope as a ceiling', () => {
    const definition = reportDataset('work_orders_by_status');
    expect(() =>
      assertReportConfiguration(
        configuration(),
        { ...definition, scope: 'company' } as unknown as typeof definition,
        {}
      )
    ).toThrow();
    expect(() =>
      assertReportConfiguration(configuration({ scope_level: 'tenant' }), definition, {})
    ).not.toThrow();
  });
});

describe('catalogue fallback cannot resurrect a tenant withdrawal', () => {
  it.each(['draft', 'archived'])('suppresses a %s baseline in list and read', async (status) => {
    const service = new ReportCatalogueService(repository(configuration({ status })));
    await expect(service.readByCode(db, input.reportCode)).rejects.toMatchObject({
      code: 'ERR-RES-001',
    });
    const page = await service.listPublished(db, {});
    expect(page.items).toEqual([]);
  });

  it('keeps absent baseline export unavailable and preserves an explicit tenant export permission', async () => {
    const baseline = await new ReportCatalogueService(repository(null)).readByCode(
      db,
      input.reportCode
    );
    expect(baseline.exportPermissionCode).toBeNull();
    const tenant = await new ReportCatalogueService(
      repository(configuration({ export_permission_code: 'iam.sensitive.export' }))
    ).readByCode(db, input.reportCode);
    expect(tenant.exportPermissionCode).toBe('iam.sensitive.export');
  });
});
