import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportRunService } from '@api/modules/reporting/application/report-run-service';
import { ReportCatalogueService } from '@api/modules/reporting/application/report-catalogue-service';
import type {
  ReportCatalogueRepository,
  ReportConfigurationRow,
} from '@api/modules/reporting/data/report-catalogue-repository';
import { assertReportConfiguration } from '@api/modules/reporting/application/report-configuration-policy';
import { reportDataset } from '@api/modules/reporting/domain/report-datasets';
import {
  REPORT_FILTER_NAMES,
  REPORT_FILTER_TYPES,
  readReportParameterVocabulary,
} from '@api/modules/reporting/domain/report-configuration';

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
    // The withdrawn code is gone, and ONLY that one. From engine slice 2 the
    // registry holds more than one baseline, so asserting an empty page would
    // assert the registry's size rather than the suppression rule — and would
    // have to be rewritten by every slice that adds a dataset, which is how a
    // property quietly turns into a count.
    expect(page.items.map((item) => item.reportCode)).not.toContain(input.reportCode);
    expect(page.items.map((item) => item.reportCode)).toContain('technician_labor_time');
    expect(page.items.find((item) => item.reportCode === 'technician_labor_time')?.source).toBe(
      'platform'
    );
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

/*
 * The vocabulary the writer and the engine now SHARE.
 *
 * These cases pin `readReportParameterVocabulary` directly rather than through
 * either caller, because it is the single definition both of them read and a
 * defect in it is a defect in both at once. The route-level and run-level
 * consequences are proven in `tests/backend/p1-31-report-configuration-seam.ts`
 * and `tests/backend/p1-31-report-engine-work-orders.test.ts` respectively.
 */
describe('the report parameter vocabulary', () => {
  it('reads the column default as no restriction, and never as an empty allowlist', () => {
    // The distinction this case defends: {} and { filters: {} } are different
    // documents. Collapsing them would make every version created without a
    // parameter schema — the shape the column defaults to — forbid every run.
    expect(readReportParameterVocabulary({})).toEqual({ kind: 'unrestricted' });
    expect(readReportParameterVocabulary({ filters: {} })).toEqual({
      kind: 'allowlist',
      names: [],
    });
  });

  it('accepts the four implemented filters, together and one at a time', () => {
    expect(readReportParameterVocabulary({ filters: allowedFilters })).toEqual({
      kind: 'allowlist',
      names: ['companyId', 'branchId', 'from', 'to'],
    });
    for (const [name, rule] of Object.entries(allowedFilters)) {
      expect(readReportParameterVocabulary({ filters: { [name]: rule } })).toEqual({
        kind: 'allowlist',
        names: [name],
      });
    }
  });

  it('names every filter the engine implements, and no more', () => {
    // A fifth name added to REPORT_FILTER_TYPES without an engine that reads it
    // would let a schema be published that the run then ignores. The list and
    // the engine move together or this case fails.
    expect(REPORT_FILTER_NAMES).toEqual(['companyId', 'branchId', 'from', 'to']);
    expect(REPORT_FILTER_TYPES).toEqual({
      companyId: 'uuid',
      branchId: 'uuid',
      from: 'date',
      to: 'date',
    });
  });

  it('refuses a document that is not a keyed object', () => {
    // `jsonb` accepts all four of these; a parameter schema is not any of them.
    for (const value of [null, [{ type: 'uuid' }], 'filters', 7]) {
      expect(readReportParameterVocabulary(value)).toEqual({
        kind: 'unrecognised',
        reason: 'it is not a JSON object',
      });
    }
  });

  it('refuses a top-level key other than filters, including a filter named at the top level', () => {
    // The second is the shape the writer accepted before this rule existed, and
    // it is exactly the document that produced a report nothing could run.
    expect(readReportParameterVocabulary({ branchId: { type: 'uuid' } })).toMatchObject({
      kind: 'unrecognised',
    });
    expect(
      readReportParameterVocabulary({ filters: { branchId: { type: 'uuid' } }, sort: 'asc' })
    ).toMatchObject({ kind: 'unrecognised' });
  });

  it('refuses an unknown filter, a rule that is not exactly {type}, and a type mismatch', () => {
    expect(readReportParameterVocabulary({ filters: { state: { type: 'text' } } })).toEqual({
      kind: 'unrecognised',
      reason: 'it names a filter this platform does not implement',
    });
    expect(
      readReportParameterVocabulary({ filters: { branchId: { type: 'uuid', required: true } } })
    ).toEqual({
      kind: 'unrecognised',
      reason: 'a filter rule declares something other than exactly one key, type',
    });
    expect(readReportParameterVocabulary({ filters: { branchId: {} } })).toMatchObject({
      kind: 'unrecognised',
    });
    // `from` is a date and reading it as a uuid is a different report.
    expect(readReportParameterVocabulary({ filters: { from: { type: 'uuid' } } })).toEqual({
      kind: 'unrecognised',
      reason: 'a filter declares a type the platform does not read it as',
    });
  });

  it('quotes no part of the submitted document in any refusal', () => {
    // A refusal is logged and displayed. A schema is tenant input, and a reason
    // that echoed it would carry that input into both.
    const secret = 'e2f4a6c8-0000-4000-8000-00000000beef';
    const verdict = readReportParameterVocabulary({ [secret]: { type: secret } });
    expect(verdict.kind).toBe('unrecognised');
    expect(verdict.kind === 'unrecognised' && verdict.reason).not.toContain(secret);
  });

  it('refuses what the runtime policy denies, on the same documents', () => {
    // The property that makes ONE definition worth having: for every document,
    // a verdict of `unrecognised` and a denied run are the same answer. A schema
    // the writer would now accept is a schema the engine can evaluate.
    const documents: readonly unknown[] = [
      {},
      { filters: allowedFilters },
      { filters: { branchId: { type: 'uuid' } } },
      { branchId: { type: 'uuid' } },
      { filters: { state: { type: 'text' } } },
      { filters: { from: { type: 'uuid' } } },
      [{ type: 'uuid' }],
    ];
    for (const parameter_schema of documents) {
      const unrecognised = readReportParameterVocabulary(parameter_schema).kind === 'unrecognised';
      let denied = false;
      try {
        assertReportConfiguration(
          configuration({ parameter_schema }),
          reportDataset('work_orders_by_status'),
          {}
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(unrecognised);
    }
  });
});
