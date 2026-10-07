'use server';

import { retryAfterSecondsOf } from '@/lib/api/client';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, success } from '@/lib/forms/action-result';
import {
  branchTargetQuery,
  query,
  readOperation,
  STATUS_BY_KIND,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import {
  isReportInstant,
  isReportPeriod,
  isSavedReportSnapshot,
  isSelectedReportExport,
  MAX_RESTATEMENT_REASON,
  reportPageSize,
  type ReportDefinition,
  type ReportExportBody,
  type ReportExportState,
  type ReportRun,
  type ReportRunState,
  type ReportScopeOptions,
  type ReportSnapshotCreateBody,
  type ReportSnapshotRows,
  type ReportSnapshotSaveState,
  type ReportSnapshotSummary,
} from './reports-contract';

/**
 * The reads and explicitly authorized export the report screens issue (P1-31, FE-011 … FE-014).
 *
 * `readOperation` and the export action use `authorizedClient()`, the only
 * network owner in this application, and turns a transport outcome into a view
 * state — so a refusal reaches the screen as a refusal and never as an empty
 * report, which an operator reads as "there was no work in that period".
 *
 * This module is `'use server'`, so it exports only async functions. Every type,
 * constant and pure helper lives in `reports-contract.ts` beside it.
 *
 * ## The branch pair is a TARGET, not a filter, and is not optional
 *
 * `rpt.report-run` declares `scope: 'branch'` and requires `companyId` and
 * `branchId`. That is authorization rather than convenience: a branch scope is
 * inert without a target, so with no pair the backend's check degrades to the
 * scope-blind permission test and a caller holding the dataset's read code in
 * one branch would report on another. The pair therefore travels through
 * `branchTargetQuery`, which refuses a half-built target instead of sending the
 * word `undefined` in a query string, and refuses to carry either half among the
 * ordinary parameters so a scope cannot be smuggled in as a filter.
 *
 * The catalogue and the definition read are tenant-scoped and take no pair at
 * all, so they use `query`, which refuses the scope names outright.
 *
 * ## The period is passed through untouched
 *
 * `from` and `to` are calendar days, `[from, to)`, resolved in the reported
 * branch's timezone by the SERVER (**D-17**). They are sent as the characters the
 * operator chose. Nothing here builds a `Date`, applies an offset, adds a day to
 * make the upper bound exclusive, or supplies a default period — the exclusive
 * upper bound is the operator's own input and a default window would be a
 * business rule nobody has decided.
 *
 * ## A Server Action is callable without the screen
 *
 * So the named company and branch are re-read from the authorized directory and
 * the pair is re-checked here, exactly as the readiness queue does. The backend
 * additionally decides `rpt.report.read` at that pair and the dataset's own
 * codes, and it remains the authority; this check only stops a browser-supplied
 * pair being forwarded because a form once offered it.
 */

/** The authorized company and branch choices. Each read enforces its own code. */
export async function readReportScopes(): Promise<ReadState<ReportScopeOptions>> {
  const [companies, branches] = await Promise.all([
    readOperation<ItemsOnly<ReportScopeOptions['companies'][number]>>('/api/v1/org/companies'),
    readOperation<ItemsOnly<ReportScopeOptions['branches'][number]>>('/api/v1/org/branches'),
  ]);
  if (companies.status !== 'ok') return companies;
  if (branches.status !== 'ok') return branches;
  return {
    status: 'ok',
    data: { companies: companies.data.items, branches: branches.data.items },
    correlationId: null,
  };
}

/**
 * The published report catalogue — `rpt.report-catalogue`.
 *
 * One page, and the first page carries the code-registered baselines before the
 * tenant's own published rows. The order is baselines first and then codes
 * ascending rather than sorted throughout, which the screen does not re-sort: a
 * client that re-ordered the page would be asserting an ordering the operation
 * does not publish.
 */
export async function listReportCatalogue(input: {
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ReadState<CursorPage<ReportDefinition>>> {
  const path =
    '/api/v1/reports' + query({ cursor: input.cursor, limit: reportPageSize(input.limit) });
  return readOperation<CursorPage<ReportDefinition>>(path);
}

/**
 * One published definition — `rpt.report-read`.
 *
 * A draft, an archived configuration, another tenant's report and a code that
 * never existed all answer the same refusal, so the screen renders "not found"
 * for every one of them and does not try to tell them apart. The code is
 * encoded into the path rather than interpolated raw.
 */
export async function readReport(reportCode: string): Promise<ReadState<ReportDefinition>> {
  return readOperation<ReportDefinition>(`/api/v1/reports/${encodeURIComponent(reportCode)}`);
}

/**
 * Runs one report — `rpt.report-run`.
 *
 * The whole envelope is returned rather than only its rows: the period, the zone
 * it was resolved in, the freshness, the filter context and the groups are all
 * part of the answer, and **D-17** requires the period and the filter context to
 * be shown wherever a result is. Paging the rows without them would let a total
 * be read without the period that produced it.
 */
export async function runReport(input: {
  readonly reportCode: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string;
  /**
   * The moment the amounts are asked for as of (Owner decision D16): an ISO-8601
   * instant, `'now'` for the moment the API reads the report, or null/absent for
   * the report's own default. Only a report that computes its amounts as of a
   * moment is sent one; the screen offers the choice only after such a report
   * answered.
   */
  readonly asOf?: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ReportRunState> {
  if (!isReportPeriod(input.from, input.to)) {
    // Refused before a request is spent. The route refuses it too — `to` is the
    // first day EXCLUDED, so an equal pair is an empty period — and answering
    // here means the operator is told which box to correct.
    return { status: 'error', correlationId: null };
  }
  const requested = input.asOf ?? null;
  if (requested !== null && requested !== 'now' && !isReportInstant(requested)) {
    return { status: 'error', correlationId: null };
  }

  const scopes = await readReportScopes();
  if (scopes.status !== 'ok') return scopes;
  if (
    !scopes.data.companies.some((company) => company.id === input.companyId) ||
    !scopes.data.branches.some(
      (branch) => branch.id === input.branchId && branch.companyId === input.companyId
    )
  ) {
    return { status: 'denied', correlationId: null };
  }

  const path =
    `/api/v1/reports/${encodeURIComponent(input.reportCode)}/rows` +
    branchTargetQuery(
      { companyId: input.companyId, branchId: input.branchId },
      {
        from: input.from,
        to: input.to,
        // "Now" travels as the word and the API resolves it on the DATABASE clock,
        // the one every compared instant was stamped by (P1-32-PRE-OD-FD16B). An
        // instant read here could run ahead of it and be refused as in the future.
        asOf: requested,
        cursor: input.cursor,
        limit: reportPageSize(input.limit),
      }
    );
  /*
   * `readOperation`, except that a 429 keeps what it said. The run is an
   * expensive read with its own per-minute limit, and the overview issues four
   * at once: a throttled answer must reach the screen as "wait", with the wait
   * the server advised, rather than as a bare "unavailable".
   */
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };
  const result = await client.get<ReportRun>(path);
  if (result.ok) return { status: 'ok', data: result.data, correlationId: result.correlationId };
  if (result.kind === 'rate-limited') {
    return {
      status: 'unavailable',
      correlationId: result.correlationId,
      throttled: true,
      retryAfterSeconds: retryAfterSecondsOf(result),
    };
  }
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}

export async function exportReport(
  reportCode: string,
  input: ReportExportBody
): Promise<ReportExportState> {
  if (
    !input ||
    typeof reportCode !== 'string' ||
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.trim().length > 500 ||
    !isReportPeriod(input.from, input.to) ||
    (input.asOf !== undefined && (typeof input.asOf !== 'string' || !isReportInstant(input.asOf)))
  ) {
    return {
      status: 'invalid',
      messageKey: 'reports.export.reasonRequired',
      fieldErrors: { reason: 'reports.export.reasonRequired' },
    };
  }
  const scopes = await readReportScopes();
  if (scopes.status !== 'ok') {
    return {
      status:
        scopes.status === 'denied'
          ? 'denied'
          : scopes.status === 'expired'
            ? 'expired'
            : 'unavailable',
      messageKey: 'action.failed',
      correlationId: scopes.correlationId,
    };
  }
  if (
    !scopes.data.companies.some((company) => company.id === input.companyId) ||
    !scopes.data.branches.some(
      (branch) => branch.id === input.branchId && branch.companyId === input.companyId
    )
  ) {
    return { status: 'denied', messageKey: 'state.denied.title' };
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message' };
  const body: ReportExportBody = {
    companyId: input.companyId,
    branchId: input.branchId,
    from: input.from,
    to: input.to,
    // The moment the shown report answered with, so the file holds its figures (D16).
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
    reason: input.reason.trim(),
  };
  const result = await client.send<unknown>(
    'POST',
    `/api/v1/reports/${encodeURIComponent(reportCode)}:export`,
    body
  );
  if (!result.ok) return fromFailure(result, 1);
  if (!isSelectedReportExport(result.data, reportCode, body)) {
    return { status: 'error', messageKey: 'action.failed', correlationId: result.correlationId };
  }
  return { ...success('reports.export.ready', 1), exported: result.data };
}

/**
 * One page of a branch's saved snapshots of a report, newest first —
 * `rpt.report-snapshot-list` (Owner decision D16, P1-32-PRE-OD-FD16B).
 *
 * Narrowed to one period when `from` and `to` are given, which is how the report
 * screen shows the snapshots, and the restatements, of the period it is showing.
 * Metadata only: a snapshot's rows are read one snapshot at a time.
 */
export async function listReportSnapshots(input: {
  readonly reportCode: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string;
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ReadState<CursorPage<ReportSnapshotSummary>>> {
  if (!isReportPeriod(input.from, input.to)) return { status: 'error', correlationId: null };
  const path =
    `/api/v1/reports/${encodeURIComponent(input.reportCode)}/snapshots` +
    branchTargetQuery(
      { companyId: input.companyId, branchId: input.branchId },
      {
        from: input.from,
        to: input.to,
        cursor: input.cursor,
        limit: reportPageSize(input.limit),
      }
    );
  return readOperation<CursorPage<ReportSnapshotSummary>>(path);
}

/**
 * One saved snapshot's frozen rows, a page at a time, with its metadata and its
 * restatements — `rpt.report-snapshot-read`. The branch is the snapshot's own, so
 * no scope travels; the backend checks it against the stored row.
 */
export async function readReportSnapshot(input: {
  readonly reportCode: string;
  readonly snapshotId: string;
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ReadState<ReportSnapshotRows>> {
  const path =
    `/api/v1/reports/${encodeURIComponent(input.reportCode)}/snapshots/` +
    `${encodeURIComponent(input.snapshotId)}/rows` +
    query({ cursor: input.cursor, limit: reportPageSize(input.limit) });
  return readOperation<ReportSnapshotRows>(path);
}

/**
 * Saves a frozen snapshot of the report as shown, or a restatement of the latest
 * one — `rpt.report-snapshot-create`.
 *
 * The moment sent is the one the shown report answered with, so the snapshot
 * holds the figures on the screen. The named branch is re-checked against the
 * authorized directory, as the export does, before anything is sent; the backend
 * remains the authority on every rule, and a refusal arrives as its own sentence.
 */
export async function saveReportSnapshot(
  reportCode: string,
  input: ReportSnapshotCreateBody
): Promise<ReportSnapshotSaveState> {
  const reason = input?.reason?.trim();
  if (
    !input ||
    typeof reportCode !== 'string' ||
    !isReportPeriod(input.from, input.to) ||
    (input.asOf !== undefined && !isReportInstant(input.asOf))
  ) {
    return { status: 'error', messageKey: 'action.failed' };
  }
  if (
    input.restatesSnapshotId !== undefined &&
    (!reason || reason.length > MAX_RESTATEMENT_REASON)
  ) {
    return {
      status: 'invalid',
      messageKey: 'reports.snapshots.reasonRequired',
      fieldErrors: { reason: 'reports.snapshots.reasonRequired' },
    };
  }
  const scopes = await readReportScopes();
  if (scopes.status !== 'ok') {
    return {
      status:
        scopes.status === 'denied'
          ? 'denied'
          : scopes.status === 'expired'
            ? 'expired'
            : 'unavailable',
      messageKey: 'action.failed',
      correlationId: scopes.correlationId,
    };
  }
  if (
    !scopes.data.companies.some((company) => company.id === input.companyId) ||
    !scopes.data.branches.some(
      (branch) => branch.id === input.branchId && branch.companyId === input.companyId
    )
  ) {
    return { status: 'denied', messageKey: 'state.denied.title' };
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message' };
  const body: ReportSnapshotCreateBody = {
    companyId: input.companyId,
    branchId: input.branchId,
    from: input.from,
    to: input.to,
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
    ...(input.restatesSnapshotId === undefined || reason === undefined
      ? {}
      : { restatesSnapshotId: input.restatesSnapshotId, reason }),
  };
  const result = await client.send<unknown>(
    'POST',
    `/api/v1/reports/${encodeURIComponent(reportCode)}/snapshots`,
    body
  );
  if (!result.ok) return fromFailure(result, 1);
  if (!isSavedReportSnapshot(result.data, body)) {
    return { status: 'error', messageKey: 'action.failed', correlationId: result.correlationId };
  }
  return {
    ...success(
      body.restatesSnapshotId === undefined
        ? 'reports.snapshots.saved'
        : 'reports.snapshots.restatedSaved',
      1
    ),
    saved: result.data.snapshot,
  };
}
