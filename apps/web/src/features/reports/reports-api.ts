'use server';

import {
  branchTargetQuery,
  query,
  readOperation,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import {
  isReportPeriod,
  reportPageSize,
  type ReportDefinition,
  type ReportRun,
  type ReportScopeOptions,
} from './reports-contract';

/**
 * The three reads the report screens issue (P1-31, FE-011 … FE-014).
 *
 * Nothing here fetches. `readOperation` calls `authorizedClient()`, the only
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
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ReadState<ReportRun>> {
  if (!isReportPeriod(input.from, input.to)) {
    // Refused before a request is spent. The route refuses it too — `to` is the
    // first day EXCLUDED, so an equal pair is an empty period — and answering
    // here means the operator is told which box to correct.
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
        cursor: input.cursor,
        limit: reportPageSize(input.limit),
      }
    );
  return readOperation<ReportRun>(path);
}
