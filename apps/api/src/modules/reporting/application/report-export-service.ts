import { Buffer } from 'node:buffer';
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { callerHoldsPermission } from '@/server/auth/authorization';
import { backendConfig } from '@/server/config/backend-config';
import type { DbHandle } from '@/server/db/transaction';
import { MAX_PAGE_SIZE } from '@/server/db/pagination';
import { isFormulaRiskyCell } from '@/modules/shared-services';
import type { ReportCatalogueRepository } from '../data/report-catalogue-repository';
import { isReportDatasetCode, reportDataset } from '../domain/report-datasets';
import { assertReportConfiguration } from './report-configuration-policy';
import type { ReportRunInput, ReportRunService, ReportRunView } from './report-run-service';

export interface ReportExportInput extends Omit<ReportRunInput, 'cursor' | 'limit'> {
  readonly reason: string;
}

export interface ReportExportView {
  readonly reportCode: string;
  readonly generated: true;
  readonly freshness: 'live';
  readonly generatedAt: string;
  readonly filters: ReportRunView['filters'];
  readonly period: ReportRunView['period'];
  readonly rowCount: number;
  readonly summaryCount: number;
  readonly file: {
    readonly filename: string;
    readonly mediaType: 'text/csv';
    readonly encoding: 'utf-8';
    readonly content: string;
  };
}

/** Inline generation has no persisted object, storage locator or enduring download grant. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function csvCell(value: string | null): string {
  const text = value ?? '';
  const safe = isFormulaRiskyCell(text) || /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvRow(values: readonly (string | null)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/** Generates only registered report rows under explicit tenant export configuration. */
export class ReportExportService extends ApplicationService {
  protected readonly module = 'reporting';

  constructor(
    private readonly repository: ReportCatalogueRepository,
    private readonly runs: Pick<ReportRunService, 'run'>
  ) {
    super();
  }

  async generate(db: DbHandle, input: ReportExportInput): Promise<ReportExportView> {
    const reason = input.reason.trim();
    if (!reason || reason.length > 500) {
      throw new AppFailure('ERR-VAL-001', { message: 'An export reason is required.' });
    }
    if (!isReportDatasetCode(input.reportCode)) {
      throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    }
    const target = { companyId: input.companyId, branchId: input.branchId };
    const definition = reportDataset(input.reportCode);
    // Service callers obey the same floor as the route. No baseline export entitlement.
    const authorize = async (): Promise<string> => {
      for (const code of ['rpt.export', 'rpt.report.read', ...definition.requiredPermissions]) {
        if (!(await callerHoldsPermission(db, code, target))) deny();
      }
      const configuration = await this.repository.findByCode(db, input.reportCode);
      if (
        !configuration ||
        configuration.status !== 'published' ||
        configuration.version_number === null ||
        !configuration.export_permission_code
      ) {
        deny();
      }
      if (!(await callerHoldsPermission(db, configuration.export_permission_code, target))) deny();
      assertReportConfiguration(configuration, definition, {
        ...target,
        from: input.from,
        to: input.to,
      });
      return configuration.id;
    };

    const configurationId = await authorize();
    const maxRows = backendConfig().EXPORT_MAX_ROWS;
    let cursor: string | undefined;
    let rowCount = 0;
    let byteCount = 0;
    let first: ReportRunView | undefined;
    const lines: string[] = [];
    const seenCursors = new Set<string>();
    const append = (line: string): void => {
      byteCount += Buffer.byteLength(line, 'utf8');
      if (byteCount > MAX_FILE_BYTES) tooLarge();
      lines.push(line);
    };

    for (;;) {
      // Reuse every dataset permission, tenant restriction and period rule; no alternate SQL.
      const page = await this.runs.run(db, {
        ...input,
        cursor,
        limit: Math.min(MAX_PAGE_SIZE, maxRows - rowCount + 1),
      });
      if (!first) {
        first = page;
        append(
          csvRow([
            'reportCode',
            'companyId',
            'branchId',
            'from',
            'toExclusive',
            'timezone',
            'generatedAt',
            'freshness',
            'recordType',
            'groupKey',
            'groupLabel',
            'groupMeasures',
            ...page.columns.flatMap((column) => [`${column.key}.value`, `${column.key}.label`]),
          ])
        );
        // An empty selection still carries its scope and period inside the downloaded file.
        append(
          csvRow([
            page.reportCode,
            page.filters.companyId,
            page.filters.branchId,
            page.period.from,
            page.period.to,
            page.period.timezone,
            page.generatedAt,
            page.freshness,
            'context',
            null,
            null,
            null,
            ...page.columns.flatMap(() => [null, null]),
          ])
        );
        // Keep the engine's exact, separately keyed aggregates; never total unlike currencies/items.
        for (const group of page.groups) {
          append(
            csvRow([
              page.reportCode,
              page.filters.companyId,
              page.filters.branchId,
              page.period.from,
              page.period.to,
              page.period.timezone,
              page.generatedAt,
              page.freshness,
              'summary',
              JSON.stringify(group.key),
              group.label,
              JSON.stringify(group.measures),
              ...page.columns.flatMap(() => [null, null]),
            ])
          );
        }
      }
      for (const row of page.rows.items) {
        rowCount += 1;
        if (rowCount > maxRows) tooLarge();
        append(
          csvRow([
            page.reportCode,
            page.filters.companyId,
            page.filters.branchId,
            page.period.from,
            page.period.to,
            page.period.timezone,
            first.generatedAt,
            page.freshness,
            'row',
            null,
            null,
            null,
            ...page.columns.flatMap((column) => {
              const cell = row.cells.find((candidate) => candidate.key === column.key);
              return [cell?.value ?? null, cell?.label ?? null];
            }),
          ])
        );
      }
      if (!page.rows.hasMore) break;
      if (rowCount >= maxRows) tooLarge();
      const next = page.rows.nextCursor;
      if (!next || seenCursors.has(next) || page.rows.items.length === 0) {
        throw new AppFailure('ERR-SYS-001', { message: 'Report pagination did not advance.' });
      }
      seenCursors.add(next);
      cursor = next;
      await authorize();
    }

    await authorize();
    const content = lines.join('');
    // The response is released only after this request's transaction commits the disclosure.
    await appendAudit(db, {
      action: 'rpt.report.exported',
      entityType: 'rpt.report_configuration',
      entityId: configurationId,
      details: [
        { field: 'report_code', classification: 'public', value: input.reportCode },
        { field: 'company_id', classification: 'internal', value: input.companyId },
        { field: 'branch_id', classification: 'internal', value: input.branchId },
        { field: 'from', classification: 'internal', value: input.from },
        { field: 'to_exclusive', classification: 'internal', value: input.to },
        { field: 'timezone', classification: 'internal', value: first.period.timezone },
        { field: 'row_count', classification: 'internal', value: String(rowCount) },
        { field: 'summary_count', classification: 'internal', value: String(first.groups.length) },
        { field: 'reason', classification: 'restricted', value: reason },
      ],
    });
    return {
      reportCode: input.reportCode,
      generated: true,
      freshness: 'live',
      generatedAt: first.generatedAt,
      filters: first.filters,
      period: first.period,
      rowCount,
      summaryCount: first.groups.length,
      file: {
        filename: `${input.reportCode}-${input.from}-${input.to}.csv`,
        mediaType: 'text/csv',
        encoding: 'utf-8',
        content,
      },
    };
  }
}

function deny(): never {
  throw new AppFailure('ERR-IAM-001', { message: 'Report export is not permitted.' });
}

function tooLarge(): never {
  throw new AppFailure('ERR-EXP-001', { message: 'Narrow the report export selection.' });
}
