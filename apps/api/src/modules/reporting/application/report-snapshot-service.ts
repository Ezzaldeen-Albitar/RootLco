/**
 * Frozen report snapshots and distinguished restatements (Owner decision D16,
 * P1-32-PRE-OD-FD16B).
 *
 * ## As of, snapshot, restatement
 *
 * An AS-OF read (P1-32-PRE-OD-FD16A) recomputes a report's amounts from immutable
 * event times every time it is read. A SNAPSHOT is a frozen copy of ONE such run —
 * its period, zone, moment, filters, columns and every row — saved once in
 * `rpt.report_snapshots` and never changed, so the figures somebody relied on can
 * be shown again exactly as they were. A RESTATEMENT is a later snapshot of the
 * same report, branch, period and filters that names the snapshot it replaces,
 * says why, and carries a summary of what changed. Nothing is overwritten: the
 * restated snapshot stays as it was, marked as restated.
 *
 * ## One consistent read
 *
 * The whole result is assembled page by page through the same `ReportRunService`
 * the screen and the export use — no second SQL for the rows — inside the
 * request's transaction, which the route opens at REPEATABLE READ: every page reads
 * the one database snapshot the transaction's first statement took, so a payment
 * committed while the pages are read cannot appear in some of them. Every page is
 * computed as of the moment the first one resolved.
 *
 * ## The chain is linear, and the database holds it so
 *
 * At most one original per (branch, report, period, filters) and at most one
 * restatement of any snapshot (two unique indexes), so the latest snapshot of a
 * period is the one nothing restates, and only that one may be restated. A second
 * save of the same period — or two at once — leaves exactly one row; the other is
 * refused by rule and the refusal is recorded (ADR-023 D12), never answered 500.
 *
 * ## Who may do what
 *
 * Saving needs `rpt.export`, `rpt.report.read` and every code the dataset
 * requires, in the reported branch: a snapshot is a durable copy of the figures,
 * and no dedicated snapshot code exists (an open Owner question). Reading needs
 * `rpt.report.read` and every code the snapshot froze; row-level security holds
 * both. A column the run names only for some callers — the party name — is stored
 * as the saver saw it and shown to a reader only under the same permission.
 */
import { Buffer } from 'node:buffer';
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { withBusinessRefusal } from '@/server/audit/business-refusals';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { backendConfig } from '@/server/config/backend-config';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  pageRequest,
  type OrderingContract,
  type Page,
} from '@/server/db/pagination';
import { isSqlState, SQLSTATE, violatedConstraint } from '@/server/db/repository';
import { iamDirectory, iamOrganizationContext } from '@/modules/iam';
import {
  isReportDatasetCode,
  reportDataset,
  type ReportDatasetDefinition,
  type ReportSnapshotDefinition,
} from '../domain/report-datasets';
import type {
  ReportSnapshotRepository,
  ReportSnapshotRow,
  ReportSnapshotTotalRow,
} from '../data/report-snapshot-repository';
import { MAX_FILE_BYTES } from './report-export-service';
import {
  assertPeriod,
  REPORT_RUN_BODY,
  type ReportCellView,
  type ReportColumnView,
  type ReportRowView,
  type ReportRunService,
  type ReportRunView,
} from './report-run-service';

/** The longest restatement reason accepted, as the database's CHECK states. */
export const MAX_RESTATEMENT_REASON = 500;

/** The audited entity of a snapshot, as `iam.audit_records.entity_type` spells it. */
const SNAPSHOT_ENTITY = 'rpt.report_snapshot';

/** The rule codes a refused snapshot names (ADR-023 D12 records each). */
export const REPORT_SNAPSHOT_RULES = Object.freeze({
  notSupported: 'report_snapshot_not_supported',
  exists: 'report_snapshot_exists',
  reasonRequired: 'report_snapshot_reason_required',
  notLatest: 'report_snapshot_not_latest',
  periodMismatch: 'report_snapshot_period_mismatch',
  tooLarge: 'report_snapshot_too_large',
});

/** Newest first; the cursor carries the microsecond `generated_at` and the id. */
const SNAPSHOT_LIST_ORDER: OrderingContract = Object.freeze({
  key: 'rpt.report_snapshots:generated_at_desc',
  direction: 'desc',
});

/** The stored order of a snapshot's rows; the cursor carries a position and the snapshot id. */
const SNAPSHOT_ROWS_ORDER: OrderingContract = Object.freeze({
  key: 'rpt.report_snapshots:rows_position_asc',
  direction: 'asc',
});

/** A person named on a snapshot. The name only where the reader may be told it. */
export interface ReportSnapshotPersonView {
  readonly id: string;
  readonly displayName: string | null;
}

/** A snapshot without its rows: what the list publishes. */
export interface ReportSnapshotSummaryView {
  readonly id: string;
  readonly reportCode: string;
  readonly period: { readonly from: string; readonly to: string; readonly timezone: string };
  /** The moment the stored amounts were computed as of. */
  readonly asOf: string;
  readonly generatedAt: string;
  readonly generatedBy: ReportSnapshotPersonView;
  readonly rowCount: number;
  /** sha256 of the canonical serialisation of the stored rows, stamped by the database. */
  readonly rowsDigest: string;
  /** The snapshot this one restates, or null for an original. */
  readonly restatesSnapshotId: string | null;
  /** The snapshot that restates this one, or null while this one is the latest. */
  readonly restatedBySnapshotId: string | null;
  /** Why this snapshot restates another; null for an original. */
  readonly restatementReason: string | null;
}

/** One money measure's total in one currency, before and after a restatement. */
export interface ReportSnapshotTotalView {
  readonly currency: string | null;
  readonly measure: string;
  /** A decimal string, or null when the side holds no such amount. */
  readonly before: string | null;
  readonly after: string | null;
}

/** What a restatement changed from the snapshot it replaces. */
export interface ReportSnapshotDifferenceView {
  readonly rowsBefore: number;
  readonly rowsAfter: number;
  readonly rowsAdded: number;
  readonly rowsRemoved: number;
  readonly rowsChanged: number;
  readonly totals: readonly ReportSnapshotTotalView[];
}

/** One snapshot's metadata, with its filters and, for a restatement, the difference. */
export interface ReportSnapshotView extends ReportSnapshotSummaryView {
  readonly filters: { readonly companyId: string; readonly branchId: string };
  readonly difference: ReportSnapshotDifferenceView | null;
}

/** The answer to a saved snapshot. */
export interface ReportSnapshotCreatedView {
  readonly snapshot: ReportSnapshotView;
}

/** One page of a report's snapshots. */
export type ReportSnapshotListView = Page<ReportSnapshotSummaryView>;

/** A snapshot's frozen rows, a page at a time, with its restatement links. */
export interface ReportSnapshotRowsView {
  readonly snapshot: ReportSnapshotView;
  /** The snapshot this one restates, or null. */
  readonly restates: ReportSnapshotSummaryView | null;
  /** The snapshot that restates this one, or null while this one is the latest. */
  readonly restatedBy: ReportSnapshotSummaryView | null;
  readonly columns: readonly ReportColumnView[];
  readonly rows: Page<ReportRowView>;
}

export interface ReportSnapshotCreateInput {
  readonly reportCode: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string;
  readonly asOf?: string | undefined;
  readonly restatesSnapshotId?: string | undefined;
  readonly reason?: string | undefined;
}

export interface ReportSnapshotListInput {
  readonly reportCode: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ReportSnapshotReadInput {
  readonly reportCode: string;
  readonly snapshotId: string;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class ReportSnapshotService extends ApplicationService {
  protected readonly module = 'reporting';

  constructor(
    private readonly repository: ReportSnapshotRepository,
    private readonly runs: Pick<ReportRunService, 'run'>
  ) {
    super();
  }

  /** Saves a frozen snapshot of one run, or a restatement of the latest one. */
  async create(db: DbHandle, input: ReportSnapshotCreateInput): Promise<ReportSnapshotCreatedView> {
    if (!isReportDatasetCode(input.reportCode)) {
      throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    }
    const definition = reportDataset(input.reportCode);
    assertPeriod(input.from, input.to);
    const target = { companyId: input.companyId, branchId: input.branchId };
    // Every code, in the reported branch, before anything is read: the right to
    // keep a durable copy of the figures and the right to see them.
    for (const code of ['rpt.export', 'rpt.report.read', ...definition.requiredPermissions]) {
      if (!(await callerHoldsPermission(db, code, target))) denied(code);
    }
    const branch = await iamOrganizationContext().branches.findBranch(db, target);
    if (branch === null) throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    const branchEntity = { entityType: 'org.branch', entityId: input.branchId };
    const snapshot = definition.snapshot;
    if (snapshot === undefined) {
      throw withBusinessRefusal(
        new AppFailure('ERR-VAL-001', {
          message: 'A snapshot cannot be saved for this report.',
          safeDetails: {
            violations: [{ path: 'path.reportCode', rule: REPORT_SNAPSHOT_RULES.notSupported }],
          },
        }),
        { ...branchEntity, rule: REPORT_SNAPSHOT_RULES.notSupported }
      );
    }

    const reason = input.reason?.trim();
    if (input.restatesSnapshotId === undefined && input.reason !== undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A reason is given only when restating a snapshot.',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'not_supported' }] },
      });
    }
    const parameters = {
      companyId: input.companyId,
      branchId: input.branchId,
      from: input.from,
      to: input.to,
    };

    let restated: ReportSnapshotRow | null = null;
    if (input.restatesSnapshotId !== undefined) {
      restated = await this.repository.findById(db, input.restatesSnapshotId);
      if (
        restated === null ||
        restated.reportCode !== definition.code ||
        restated.companyId !== input.companyId ||
        restated.branchId !== input.branchId
      ) {
        throw new AppFailure('ERR-RES-001', { message: 'Snapshot not found.' });
      }
      const restatedEntity = { entityType: SNAPSHOT_ENTITY, entityId: restated.id };
      if (reason === undefined || reason === '') {
        throw withBusinessRefusal(
          new AppFailure('ERR-VAL-001', {
            message: 'Say why the snapshot is being restated.',
            safeDetails: {
              violations: [{ path: 'body.reason', rule: REPORT_SNAPSHOT_RULES.reasonRequired }],
            },
          }),
          { ...restatedEntity, rule: REPORT_SNAPSHOT_RULES.reasonRequired }
        );
      }
      if (reason.length > MAX_RESTATEMENT_REASON) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The reason is too long.',
          safeDetails: { violations: [{ path: 'body.reason', rule: 'too_long' }] },
        });
      }
      if (restated.restatedBySnapshotId !== null) {
        throw notLatest(restated.id);
      }
      if (restated.periodFrom !== input.from || restated.periodToExclusive !== input.to) {
        throw withBusinessRefusal(
          new AppFailure('ERR-VAL-001', {
            message: 'A restatement covers the same period as the snapshot it replaces.',
            safeDetails: {
              violations: [
                { path: 'body.restatesSnapshotId', rule: REPORT_SNAPSHOT_RULES.periodMismatch },
              ],
            },
          }),
          { ...restatedEntity, rule: REPORT_SNAPSHOT_RULES.periodMismatch }
        );
      }
    } else {
      const existing = await this.repository.findOriginal(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        reportCode: definition.code,
        periodFrom: input.from,
        periodToExclusive: input.to,
        parameters,
      });
      if (existing !== null) throw alreadySaved(SNAPSHOT_ENTITY, existing.id);
    }

    const refusalEntity =
      restated === null ? branchEntity : { entityType: SNAPSHOT_ENTITY, entityId: restated.id };
    const result = await this.readWholeReport(db, input, refusalEntity);
    const difference =
      restated === null
        ? null
        : await this.difference(db, restated, result.rows, snapshot, definition);

    let stored: ReportSnapshotRow;
    try {
      stored = await this.repository.insert(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        reportCode: definition.code,
        periodFrom: input.from,
        periodToExclusive: input.to,
        timezoneName: result.first.period.timezone,
        asOf: result.asOf,
        parameters,
        requiredPermissions: definition.requiredPermissions,
        columns: result.first.columns,
        rows: result.rows,
        restatesSnapshotId: restated?.id ?? null,
        restatementReason: restated === null ? null : (reason ?? null),
        difference: difference === null ? null : { ...difference },
      });
    } catch (error) {
      // A concurrent save of the same period, or a concurrent restatement of the
      // same snapshot, lost the race at the unique index: refused by rule, not 500.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        const constraint = violatedConstraint(error);
        if (constraint === 'uq_report_snapshots_original') {
          throw alreadySaved(branchEntity.entityType, branchEntity.entityId);
        }
        if (constraint === 'uq_report_snapshots_restates' && restated !== null) {
          throw notLatest(restated.id);
        }
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'rpt.report.snapshot_created',
      entityType: SNAPSHOT_ENTITY,
      entityId: stored.id,
      companyId: input.companyId,
      branchId: input.branchId,
      details: [
        { field: 'report_code', classification: 'public', value: definition.code },
        { field: 'from', classification: 'internal', value: input.from },
        { field: 'to_exclusive', classification: 'internal', value: input.to },
        { field: 'timezone', classification: 'internal', value: stored.timezoneName },
        { field: 'as_of', classification: 'internal', value: stored.asOf.toISOString() },
        { field: 'row_count', classification: 'internal', value: String(stored.rowCount) },
        { field: 'rows_digest', classification: 'internal', value: stored.rowsDigest },
        ...(restated === null
          ? []
          : [
              {
                field: 'restates_snapshot_id',
                classification: 'internal' as const,
                value: restated.id,
              },
              {
                field: 'restatement_reason',
                classification: 'restricted' as const,
                value: stored.restatementReason,
              },
            ]),
      ],
    });

    const names = await peopleNamed(db, [stored.generatedBy]);
    return { snapshot: view(stored, names) };
  }

  /** One page of a report's snapshots in one branch, newest first. Metadata only. */
  async list(db: DbHandle, input: ReportSnapshotListInput): Promise<ReportSnapshotListView> {
    const definition = await this.authorizeRead(db, input.reportCode, {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (definition.snapshot === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'This report keeps no snapshots.',
        safeDetails: {
          violations: [{ path: 'path.reportCode', rule: REPORT_SNAPSHOT_RULES.notSupported }],
        },
      });
    }
    if ((input.from === undefined) !== (input.to === undefined)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Give both ends of the period, or neither.',
        safeDetails: {
          violations: [
            { path: input.from === undefined ? 'query.from' : 'query.to', rule: 'required' },
          ],
        },
      });
    }
    if (input.from !== undefined && input.to !== undefined) assertPeriod(input.from, input.to);
    const branch = await iamOrganizationContext().branches.findBranch(db, {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (branch === null) throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });

    const request = pageRequest(SNAPSHOT_LIST_ORDER, {
      cursor: input.cursor,
      limit: input.limit,
    });
    const rows = await this.repository.list(
      db,
      {
        companyId: input.companyId,
        branchId: input.branchId,
        reportCode: definition.code,
        periodFrom: input.from ?? null,
        periodToExclusive: input.to ?? null,
      },
      request
    );
    const page = buildPageWithCursors(
      rows.map((row) => ({ item: row, sortValue: row.sortValue, id: row.id })),
      request,
      SNAPSHOT_LIST_ORDER
    );
    const people = await peopleNamed(
      db,
      page.items.map((row) => row.generatedBy)
    );
    return { ...page, items: page.items.map((row) => summary(row, people)) };
  }

  /** A snapshot's frozen rows, a page at a time, with its restatement links. */
  async read(
    db: DbHandle,
    input: ReportSnapshotReadInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReportSnapshotRowsView> {
    if (!isReportDatasetCode(input.reportCode)) {
      throw new AppFailure('ERR-RES-001', { message: 'Snapshot not found.' });
    }
    const definition = reportDataset(input.reportCode);
    const request = pageRequest(SNAPSHOT_ROWS_ORDER, {
      cursor: input.cursor,
      limit: input.limit,
    });
    const stored = await this.repository.findById(db, input.snapshotId);
    if (stored === null || stored.reportCode !== definition.code) {
      // Absent, another tenant's, out of reach, or unreadable without the codes it
      // froze: row-level security answers all of them identically.
      throw new AppFailure('ERR-RES-001', { message: 'Snapshot not found.' });
    }
    const scope = { companyId: stored.companyId, branchId: stored.branchId };
    // The route's own code, in the snapshot's own branch.
    await authorizeScope(scope);
    // And every code the snapshot froze, as row-level security already required.
    for (const code of stored.requiredPermissions) {
      if (!(await callerHoldsPermission(db, code, scope))) denied(code);
    }
    if (request.cursor !== null && request.cursor.i !== stored.id) {
      throw new AppFailure('ERR-PAG-001', { message: 'Cursor was issued for another snapshot' });
    }
    const after = request.cursor === null ? '0' : positionOf(request.cursor.v);
    const fetched = await this.repository.rowsPage(db, stored.id, after, request.limit);
    const withheld = await this.withheldKeys(db, definition.snapshot, scope);
    const page = buildPageWithCursors(
      fetched.map((entry) => ({
        item: withhold(entry.row as ReportRowView, withheld),
        sortValue: entry.position,
        id: stored.id,
      })),
      request,
      SNAPSHOT_ROWS_ORDER
    );

    const restates =
      stored.restatesSnapshotId === null
        ? null
        : await this.repository.findById(db, stored.restatesSnapshotId);
    const restatedBy =
      stored.restatedBySnapshotId === null
        ? null
        : await this.repository.findById(db, stored.restatedBySnapshotId);
    const people = await peopleNamed(
      db,
      [stored, restates, restatedBy]
        .filter((row): row is ReportSnapshotRow => row !== null)
        .map((row) => row.generatedBy)
    );
    return {
      snapshot: view(stored, people),
      restates: restates === null ? null : summary(restates, people),
      restatedBy: restatedBy === null ? null : summary(restatedBy, people),
      columns: stored.columns as readonly ReportColumnView[],
      rows: page,
    };
  }

  /** The route's read code is the operation's; the dataset's codes are checked here. */
  private async authorizeRead(
    db: DbHandle,
    reportCode: string,
    target: { readonly companyId: string; readonly branchId: string }
  ): Promise<ReportDatasetDefinition> {
    if (!isReportDatasetCode(reportCode)) {
      throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    }
    const definition = reportDataset(reportCode);
    for (const code of definition.requiredPermissions) {
      if (!(await callerHoldsPermission(db, code, target))) denied(code);
    }
    return definition;
  }

  /**
   * Every page of the run, as of ONE moment, inside the request's transaction.
   *
   * Capped exactly as the export is: the configured row bound and the same byte
   * bound, measured over the rows as they will be stored.
   */
  private async readWholeReport(
    db: DbHandle,
    input: ReportSnapshotCreateInput,
    refusalEntity: { readonly entityType: string; readonly entityId: string }
  ): Promise<{ first: ReportRunView; asOf: string; rows: ReportRowView[] }> {
    const maxRows = backendConfig().EXPORT_MAX_ROWS;
    const rows: ReportRowView[] = [];
    let bytes = 2;
    let first: ReportRunView | undefined;
    let cursor: string | undefined;
    const seen = new Set<string>();
    const tooLarge = (): never => {
      throw withBusinessRefusal(
        new AppFailure('ERR-EXP-001', {
          message: 'This report is too large to keep as a snapshot. Narrow the period.',
          safeDetails: {
            violations: [{ path: 'body', rule: REPORT_SNAPSHOT_RULES.tooLarge }],
          },
        }),
        { ...refusalEntity, rule: REPORT_SNAPSHOT_RULES.tooLarge }
      );
    };
    for (;;) {
      const page = await this.runs.run(
        db,
        {
          reportCode: input.reportCode,
          companyId: input.companyId,
          branchId: input.branchId,
          from: input.from,
          to: input.to,
          ...(first?.asOf !== undefined
            ? { asOf: first.asOf }
            : input.asOf === undefined
              ? {}
              : { asOf: input.asOf }),
          cursor,
          limit: Math.min(100, maxRows - rows.length + 1),
        },
        REPORT_RUN_BODY
      );
      first ??= page;
      for (const row of page.rows.items) {
        rows.push(row);
        if (rows.length > maxRows) tooLarge();
        bytes += Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
        if (bytes > MAX_FILE_BYTES) tooLarge();
      }
      if (!page.rows.hasMore) break;
      if (rows.length >= maxRows) tooLarge();
      const next = page.rows.nextCursor;
      if (!next || seen.has(next) || page.rows.items.length === 0) {
        throw new AppFailure('ERR-SYS-001', { message: 'Report pagination did not advance.' });
      }
      seen.add(next);
      cursor = next;
    }
    if (first.asOf === undefined) {
      // Only a dataset computed as of a moment declares snapshots; reaching here
      // without a moment is a registry defect, never a reason to freeze live rows.
      throw new AppFailure('ERR-SYS-001', { message: 'The report moment was not resolved.' });
    }
    return { first, asOf: first.asOf, rows };
  }

  /** What a restatement changes: rows by identity, and totals per currency by SQL. */
  private async difference(
    db: DbHandle,
    restated: ReportSnapshotRow,
    rows: readonly ReportRowView[],
    snapshot: ReportSnapshotDefinition,
    definition: ReportDatasetDefinition
  ): Promise<ReportSnapshotDifferenceView> {
    const identity = (row: ReportRowView): string | null =>
      row.cells.find((cell) => cell.key === snapshot.identityColumn)?.value ?? null;
    const before = new Map<string, string>();
    for (const row of (await this.repository.rowsOf(db, restated.id)) as ReportRowView[]) {
      const key = identity(row);
      if (key !== null) before.set(key, canonicalRow(row));
    }
    const after = new Map<string, string>();
    for (const row of rows) {
      const key = identity(row);
      if (key !== null) after.set(key, canonicalRow(row));
    }
    let added = 0;
    let changed = 0;
    for (const [key, value] of after) {
      const previous = before.get(key);
      if (previous === undefined) added += 1;
      else if (previous !== value) changed += 1;
    }
    let removed = 0;
    for (const key of before.keys()) if (!after.has(key)) removed += 1;

    const moneyColumns = definition.columns
      .filter((column) => column.kind === 'money')
      .map((column) => column.key);
    const totals = await this.repository.totalsByCurrency(db, {
      restatedId: restated.id,
      rows,
      currencyColumn: snapshot.currencyColumn,
      moneyColumns,
    });
    return {
      rowsBefore: restated.rowCount,
      rowsAfter: rows.length,
      rowsAdded: added,
      rowsRemoved: removed,
      rowsChanged: changed,
      totals: pairTotals(totals),
    };
  }

  /** The withheld columns this reader may not be shown, in the snapshot's branch. */
  private async withheldKeys(
    db: DbHandle,
    snapshot: ReportSnapshotDefinition | undefined,
    scope: { readonly companyId: string; readonly branchId: string }
  ): Promise<ReadonlySet<string>> {
    const keys = new Set<string>();
    for (const column of snapshot?.withheldColumns ?? []) {
      if (!(await callerHoldsPermission(db, column.permission, scope))) keys.add(column.key);
    }
    return keys;
  }
}

function denied(code: string): never {
  throw new AppFailure('ERR-IAM-001', {
    message: 'Report snapshot is not permitted.',
    safeDetails: { requiredPermissions: [code] },
  });
}

function alreadySaved(entityType: string, entityId: string): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-RES-002', {
      message:
        'A snapshot of this report for this period already exists. To replace it, restate it with a reason.',
      safeDetails: { violations: [{ path: 'body', rule: REPORT_SNAPSHOT_RULES.exists }] },
    }),
    { entityType, entityId, rule: REPORT_SNAPSHOT_RULES.exists }
  );
}

function notLatest(restatedId: string): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-TRN-001', {
      message: 'This snapshot has already been restated. Restate the latest snapshot instead.',
      safeDetails: {
        violations: [{ path: 'body.restatesSnapshotId', rule: REPORT_SNAPSHOT_RULES.notLatest }],
      },
    }),
    { entityType: SNAPSHOT_ENTITY, entityId: restatedId, rule: REPORT_SNAPSHOT_RULES.notLatest }
  );
}

/** A row's cells in a fixed key order, so two equal rows compare equal. */
function canonicalRow(row: ReportRowView): string {
  return JSON.stringify(
    [...row.cells]
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .map((cell) => [cell.key, cell.label, cell.value])
  );
}

/** Before and after side by side, per currency and measure, in a stable order. */
function pairTotals(rows: readonly ReportSnapshotTotalRow[]): ReportSnapshotTotalView[] {
  const paired = new Map<
    string,
    { currency: string | null; measure: string; before: string | null; after: string | null }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.currency, row.measure]);
    const entry = paired.get(key) ?? {
      currency: row.currency,
      measure: row.measure,
      before: null,
      after: null,
    };
    if (row.side === 'before') entry.before = row.total;
    else entry.after = row.total;
    paired.set(key, entry);
  }
  return [...paired.values()];
}

/**
 * A cursor position: a positive integer in decimal, kept as the string it is and
 * cast by PostgreSQL. This module is on the exact-money surface, which converts
 * no string to a JavaScript number.
 */
function positionOf(value: string): string {
  if (!/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new AppFailure('ERR-PAG-001', { message: 'Cursor position is invalid' });
  }
  return value;
}

/** The row with each withheld cell read as empty. */
function withhold(row: ReportRowView, keys: ReadonlySet<string>): ReportRowView {
  if (keys.size === 0) return row;
  return {
    cells: row.cells.map((cell): ReportCellView =>
      keys.has(cell.key) ? { key: cell.key, label: null, value: null } : cell
    ),
  };
}

async function peopleNamed(
  db: DbHandle,
  ids: readonly string[]
): Promise<ReadonlyMap<string, { readonly displayName: string | null }>> {
  return iamDirectory().directory.resolveDisplayIdentities(db, [...new Set(ids)]);
}

function summary(
  row: ReportSnapshotRow,
  people: ReadonlyMap<string, { readonly displayName: string | null }>
): ReportSnapshotSummaryView {
  return {
    id: row.id,
    reportCode: row.reportCode,
    period: { from: row.periodFrom, to: row.periodToExclusive, timezone: row.timezoneName },
    asOf: row.asOf.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: {
      id: row.generatedBy,
      displayName: people.get(row.generatedBy)?.displayName ?? null,
    },
    rowCount: row.rowCount,
    rowsDigest: row.rowsDigest,
    restatesSnapshotId: row.restatesSnapshotId,
    restatedBySnapshotId: row.restatedBySnapshotId,
    restatementReason: row.restatementReason,
  };
}

function view(
  row: ReportSnapshotRow,
  people: ReadonlyMap<string, { readonly displayName: string | null }>
): ReportSnapshotView {
  return {
    ...summary(row, people),
    filters: { companyId: row.companyId, branchId: row.branchId },
    difference: row.difference as ReportSnapshotDifferenceView | null,
  };
}
