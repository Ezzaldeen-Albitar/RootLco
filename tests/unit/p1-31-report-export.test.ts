import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportExportService } from '@api/modules/reporting/application/report-export-service';
import type { ReportRunView } from '@api/modules/reporting/application/report-run-service';
import type { ReportCatalogueRepository } from '@api/modules/reporting/data/report-catalogue-repository';

const calls = vi.hoisted(() => ({ permission: vi.fn(), audit: vi.fn(), maxRows: 3 }));
vi.mock('@/server/auth/authorization', () => ({ callerHoldsPermission: calls.permission }));
vi.mock('@/server/audit/audit', () => ({ appendAudit: calls.audit }));
vi.mock('@/server/config/backend-config', () => ({
  backendConfig: () => ({ EXPORT_MAX_ROWS: calls.maxRows }),
}));

const db = {} as never;
const input = {
  reportCode: 'work_orders_by_status',
  companyId: 'a1310000-0000-4000-8000-000000000001',
  branchId: 'a1310000-0000-4000-8000-000000000002',
  from: '2027-03-02',
  to: '2027-03-04',
  reason: 'Approved operational review',
};
const configuration = {
  id: 'a1310000-0000-4000-8000-000000000003',
  report_code: input.reportCode,
  status: 'published',
  version_number: 1,
  scope_level: 'branch',
  export_permission_code: 'sal.finance.view',
  parameter_schema: {},
};
const findByCode = vi.fn();
const run = vi.fn();
const service = new ReportExportService({ findByCode } as unknown as ReportCatalogueRepository, {
  run,
});

function page(values: string[], nextCursor: string | null = null): ReportRunView {
  return {
    reportCode: input.reportCode,
    titleKey: 'reports.title',
    scope: 'branch',
    filters: { companyId: input.companyId, branchId: input.branchId },
    period: { from: input.from, to: input.to, timezone: 'Asia/Amman' },
    branch: { id: input.branchId, name: 'Branch' },
    generatedAt: '2026-09-14T00:00:00Z',
    freshness: 'live',
    columns: [{ key: 'customer', kind: 'text', drillThrough: null, drillThroughByKind: null }],
    groups: [],
    countsByState: [],
    rows: {
      items: values.map((value) => ({ cells: [{ key: 'customer', value, label: value }] })),
      hasMore: nextCursor !== null,
      nextCursor,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.maxRows = 3;
  calls.permission.mockResolvedValue(true);
  calls.audit.mockResolvedValue(undefined);
  findByCode.mockResolvedValue(configuration);
  run.mockResolvedValue(page(['ordinary']));
});

describe('P1-31 report export disclosure', () => {
  it('returns generated CSV, scoped context and an audit record for the actual row count', async () => {
    run.mockResolvedValueOnce(page(['first'], 'cursor-1')).mockResolvedValueOnce(page(['ثاني']));
    const result = await service.generate(db, input);
    expect(result).toMatchObject({ generated: true, rowCount: 2, freshness: 'live' });
    expect(result.file).toMatchObject({ mediaType: 'text/csv', encoding: 'utf-8' });
    expect(result.file.content).toContain('"ثاني","ثاني"');
    expect(result.file.content).toContain('"Asia/Amman"');
    expect(run).toHaveBeenNthCalledWith(2, db, expect.objectContaining({ cursor: 'cursor-1' }));
    expect(calls.audit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'rpt.report.exported',
        entityId: configuration.id,
        details: expect.arrayContaining([
          { field: 'row_count', classification: 'internal', value: '2' },
        ]),
      })
    );
  });

  it.each(['rpt.export', 'rpt.report.read', 'wo.work_order.read', 'sal.finance.view'])(
    'refuses missing %s before reading rows',
    async (missing) => {
      calls.permission.mockImplementation(async (_db, code) => code !== missing);
      await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-IAM-001' });
      expect(run).not.toHaveBeenCalled();
      expect(calls.audit).not.toHaveBeenCalled();
      expect(calls.permission).toHaveBeenCalledWith(db, missing, {
        companyId: input.companyId,
        branchId: input.branchId,
      });
    }
  );

  it.each([
    null,
    { ...configuration, status: 'archived' },
    { ...configuration, version_number: null },
  ])(
    'does not inherit an export entitlement from a baseline or unpublished configuration',
    async (row) => {
      findByCode.mockResolvedValue(row);
      await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-IAM-001' });
      expect(run).not.toHaveBeenCalled();
    }
  );

  it('refuses a published parameter restriction rather than exporting an unfiltered selection', async () => {
    findByCode.mockResolvedValue({ ...configuration, parameter_schema: { filters: {} } });
    await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-IAM-001' });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['=SUM(1,2)', '+cmd', '-123', '@SUM(A1)', '\tformula', '\rformula', '  =1', '\n=1'])(
    'neutralizes spreadsheet evaluation for %j',
    async (value) => {
      run.mockResolvedValue(page([value]));
      const result = await service.generate(db, input);
      expect(result.file.content).toContain(`"'${value}","'${value}"`);
    }
  );

  it('quotes embedded delimiters, quotes and line breaks', async () => {
    run.mockResolvedValue(page(['a,"b"\nc']));
    expect((await service.generate(db, input)).file.content).toContain('"a,""b""\nc"');
  });

  it('retains separate exact aggregate measures and their currency keys', async () => {
    run.mockResolvedValue({
      ...page(['row']),
      groups: [
        {
          key: { currency: 'USD' },
          label: 'Dollars',
          measures: { amount: '9007199254740993.1200' },
        },
        { key: { currency: 'JOD' }, label: 'Dinars', measures: { amount: '-1.2500' } },
      ],
    });
    const result = await service.generate(db, input);
    expect(result.summaryCount).toBe(2);
    expect(result.file.content).toContain('""currency"":""USD""');
    expect(result.file.content).toContain('""currency"":""JOD""');
    expect(result.file.content).toContain('9007199254740993.1200');
    expect(result.file.content).toContain('-1.2500');
    expect(result.file.content).toContain('"summary"');
  });

  it('refuses a selection beyond the row bound without a partial export or success audit', async () => {
    run.mockResolvedValue(page(['a', 'b', 'c'], 'more'));
    await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-EXP-001' });
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('accepts exactly the configured maximum only when the selection ends', async () => {
    run.mockResolvedValue(page(['a', 'b', 'c']));
    expect((await service.generate(db, input)).rowCount).toBe(3);
  });

  it('bounds encoded output independently of row count', async () => {
    run.mockResolvedValue(page(['x'.repeat(5 * 1024 * 1024)]));
    await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-EXP-001' });
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('refuses broken pagination rather than returning an incomplete file', async () => {
    run.mockResolvedValue({ ...page(['a']), rows: { ...page(['a']).rows, hasMore: true } });
    await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-SYS-001' });
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('rechecks configured restrictions before releasing generated content', async () => {
    findByCode
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce({ ...configuration, parameter_schema: { filters: {} } });
    await expect(service.generate(db, input)).rejects.toMatchObject({ code: 'ERR-IAM-001' });
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('does not return generated content when audit append fails', async () => {
    calls.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.generate(db, input)).rejects.toThrow('audit unavailable');
  });
});
