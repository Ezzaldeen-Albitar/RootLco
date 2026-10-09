'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { listReportSnapshots, readReportSnapshot, saveReportSnapshot } from '../reports-api';
import { fieldHeading, formatReportMoney, formatReportTime } from '../report-labels';
import {
  MAX_RESTATEMENT_REASON,
  REPORT_PAGE_SIZE,
  type ReportColumn,
  type ReportRow,
  type ReportScopeSelection,
  type ReportSnapshotRows,
  type ReportSnapshotSummary,
} from '../reports-contract';
import { MachineName } from './ReportShell';
import { ReportFormDialog } from './ReportFormDialog';
import { useCursorTrail } from './use-cursor-trail';

/**
 * Saved snapshots of the report on the screen (Owner decision D16,
 * P1-32-PRE-OD-FD16B), on the Material UI wrappers (P1-32-PRE-OD-REPB).
 *
 * The report above is recomputed every time it is read, as of the moment it
 * states. A snapshot keeps ONE such reading, exactly as it was, for this branch
 * and period: a payment, credit or reversal recorded later never changes it. To
 * correct one, the latest snapshot is RESTATED with a reason — a new snapshot that
 * names the one it replaces and says what changed; the earlier one is kept and
 * says it was restated.
 *
 * Saving and restating are offered only to an operator holding
 * `rpt.report.configure` (P1-32-PRE-OD-FD16C), which is what the backend
 * requires beside `rpt.report.read` and the dataset's own codes; the panel is
 * drawn only on a run the backend answered, which already required those codes.
 * Reading needs only the report. Every figure here is the server's: nothing is
 * computed in the browser.
 *
 * The list is the snapshot list operation's cursor pages on `OperationalGrid`
 * (route checklist G1–G12), so every snapshot of the period is reachable, not
 * only the first page. Saving and restating are form dialogs (`role="dialog"`),
 * each sending once however often it is pressed; a refused duplicate original
 * and a refused restatement of a snapshot already restated each name the latest
 * snapshot of the period and offer it.
 */
export function ReportSnapshotsPanel({
  locale,
  messages,
  reportCode,
  selection,
  companyName,
  branchName,
  zone,
  asOf,
  asOfMoment,
  canSave,
  renderRows,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly selection: ReportScopeSelection;
  readonly companyName: string | null;
  readonly branchName: string | null;
  /** The reported branch's zone, which every moment here is shown on. */
  readonly zone: string;
  /** The moment the shown report answered with; a snapshot saves those figures. */
  readonly asOf: string | null;
  /** `asOf` as the operator reads it: on the branch's clock, with the zone named. */
  readonly asOfMoment: string | null;
  /** Whether the save and restate actions are offered (`rpt.report.configure`). */
  readonly canSave: boolean;
  /** The report's own row table, so a frozen row reads exactly as a live one. */
  readonly renderRows: (columns: readonly ReportColumn[], rows: readonly ReportRow[]) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // A failed read of the opened snapshot is retried by mounting it afresh.
  const [viewAttempt, setViewAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [latest, setLatest] = useState<ReportSnapshotSummary | null>(null);
  // Set synchronously on the first press, so a second press in the same tick
  // finds the save already under way and sends nothing.
  const saving = useRef(false);

  const { companyId, branchId, from, to } = selection;
  const load = useCallback(
    async (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<ReportSnapshotSummary>> => {
      const page = await listReportSnapshots({
        reportCode,
        companyId,
        branchId,
        from,
        to,
        cursor,
        limit: request.pageSize,
      });
      if (page.status !== 'ok') {
        return {
          status: page.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: page.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: page.data.items,
        nextCursor: page.data.nextCursor,
        hasMore: page.data.hasMore,
        correlationId: page.correlationId,
      };
    },
    [reportCode, companyId, branchId, from, to]
  );
  const table = useServerTable<ReportSnapshotSummary>(load, {
    initial: INITIAL_REQUEST,
    loadKey: `${reportCode}|${companyId}|${branchId}|${from}|${to}`,
  });

  /**
   * The newest snapshot of the period — the head of its restatement chain, which
   * nothing newer can have restated — read afresh when a save or a restatement is
   * refused because another one got there first, so the refusal names it.
   */
  const findLatest = useCallback(async (): Promise<void> => {
    const page = await listReportSnapshots({
      reportCode,
      companyId,
      branchId,
      from,
      to,
      cursor: null,
      limit: 1,
    });
    setLatest(page.status === 'ok' ? (page.data.items[0] ?? null) : null);
  }, [reportCode, companyId, branchId, from, to]);

  const person = useCallback(
    (summary: ReportSnapshotSummary): string =>
      summary.generatedBy.displayName ?? translate(messages, 'reports.snapshots.nameHidden'),
    [messages]
  );
  const moment = useCallback(
    (instant: string): string => formatReportTime(instant, locale, zone),
    [locale, zone]
  );

  async function save(): Promise<void> {
    if (asOf === null || saving.current) return;
    saving.current = true;
    setPending(true);
    setRefusal(undefined);
    setLatest(null);
    try {
      const result = await saveReportSnapshot(reportCode, { ...selection, asOf });
      if (result.status === 'success' && result.saved) {
        notifyActionResult(result, messages);
        setAsking(false);
        setSelected(result.saved.id);
        table.refresh();
        return;
      }
      setRefusal(refusalSentence(messages, result));
      if (isTakenRefusal(result)) {
        // Somebody saved this period first: the list moves, and the refusal
        // names the snapshot that now stands for it.
        table.refresh();
        await findLatest();
      }
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const columns = useMemo<readonly OperationalColumn<ReportSnapshotSummary>[]>(
    () => [
      {
        id: 'savedAt',
        headerKey: 'reports.snapshots.column.savedAt',
        flex: 1.2,
        cell: (row) => <time dateTime={row.generatedAt}>{moment(row.generatedAt)}</time>,
      },
      {
        id: 'savedBy',
        headerKey: 'reports.snapshots.column.savedBy',
        flex: 1.2,
        hideBelow: 'md',
        cell: (row) => <bdi>{person(row)}</bdi>,
      },
      {
        id: 'asOf',
        headerKey: 'reports.snapshots.column.asOf',
        flex: 1.2,
        cell: (row) => <time dateTime={row.asOf}>{moment(row.asOf)}</time>,
      },
      {
        id: 'rows',
        headerKey: 'reports.snapshots.column.rows',
        numeric: true,
        hideBelow: 'sm',
        cell: (row) => <span dir="ltr">{String(row.rowCount)}</span>,
      },
      {
        id: 'kind',
        headerKey: 'reports.snapshots.column.kind',
        cell: (row) => (
          <span className="flex flex-col" lang={locale}>
            <span>
              {translate(
                messages,
                row.restatesSnapshotId === null
                  ? 'reports.snapshots.kind.original'
                  : 'reports.snapshots.kind.restatement'
              )}
            </span>
            {row.restatedBySnapshotId === null ? null : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'reports.snapshots.kind.restated')}
              </span>
            )}
          </span>
        ),
      },
    ],
    [locale, messages, moment, person]
  );

  // "View" is a choice among the rows (G12): pressed on the one shown below.
  const rowActions = useCallback(
    (row: ReportSnapshotSummary): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'reports.snapshots.view'),
        about: moment(row.generatedAt),
        pressed: selected === row.id,
        onClick: () => setSelected(row.id),
      },
    ],
    [messages, moment, selected]
  );

  const openLatest = (id: string) => {
    setAsking(false);
    setRefusal(undefined);
    setLatest(null);
    setSelected(id);
  };

  return (
    <section
      aria-labelledby="report-snapshots-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="report-snapshots"
    >
      <h4 id="report-snapshots-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'reports.snapshots.heading')}
      </h4>
      <p className="text-caption text-text-secondary" lang={locale}>
        {translate(messages, 'reports.snapshots.explain')}
      </p>
      {canSave && asOf !== null ? (
        <div>
          <Button
            variant="contained"
            onClick={() => {
              setRefusal(undefined);
              setLatest(null);
              setAsking(true);
            }}
          >
            {translate(messages, 'reports.snapshots.save')}
          </Button>
        </div>
      ) : null}

      <OperationalGrid<ReportSnapshotSummary>
        messages={messages}
        locale={locale}
        label={translate(messages, 'reports.snapshots.listCaption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        stateDescriptions={{
          unavailable: 'reports.snapshots.unavailable',
          error: 'reports.snapshots.unavailable',
        }}
        testId="report-snapshot-list"
      />
      {table.status === 'idle' && table.response !== null && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="reports.snapshots.noneTitle"
          descriptionKey="reports.snapshots.none"
          testId="report-snapshots-none"
        />
      ) : null}

      {selected === null ? null : (
        <SnapshotView
          key={`${selected}#${String(viewAttempt)}`}
          locale={locale}
          messages={messages}
          reportCode={reportCode}
          snapshotId={selected}
          zone={zone}
          canRestate={canSave && asOf !== null}
          restateAsOf={asOf}
          selection={selection}
          renderRows={renderRows}
          onOpen={setSelected}
          onRetry={() => setViewAttempt((value) => value + 1)}
          onClose={() => setSelected(null)}
          onRestated={(id) => {
            setSelected(id);
            table.refresh();
          }}
          onListMoved={() => table.refresh()}
        />
      )}

      {asking ? (
        <ReportFormDialog
          title={translate(messages, 'reports.snapshots.saveTitle')}
          description={formatMessage(translate(messages, 'reports.snapshots.saveSummary'), {
            company: companyName ?? '',
            branch: branchName ?? '',
            from,
            to,
            moment: asOfMoment ?? '',
          })}
          submitLabel={translate(messages, 'reports.snapshots.saveConfirm')}
          pendingLabel={translate(messages, 'reports.snapshots.saving')}
          cancelLabel={translate(messages, 'reports.snapshots.restateCancel')}
          pending={pending}
          error={refusal}
          refusalDetail={
            latest === null ? null : (
              <LatestSnapshot
                locale={locale}
                messages={messages}
                summary={latest}
                moment={moment}
                person={person}
                onOpen={openLatest}
              />
            )
          }
          focusSubmit
          testId="report-snapshot-save-dialog"
          onCancel={() => {
            if (pending) return;
            setAsking(false);
            setRefusal(undefined);
            setLatest(null);
          }}
          onSubmit={() => {
            void save();
          }}
        />
      ) : null}
    </section>
  );
}

/** Whether a refusal says another snapshot already stands where this one would. */
function isTakenRefusal(state: ActionState): boolean {
  return (
    state.messageKey === 'form.violation.report_snapshot_exists' ||
    state.messageKey === 'form.violation.report_snapshot_not_latest'
  );
}

/**
 * The snapshot a refusal is about, named the way the list names it — when it was
 * saved, by whom, and the moment its amounts are as of — never by identifier,
 * with the way to open it.
 */
function LatestSnapshot({
  locale,
  messages,
  summary,
  moment,
  person,
  onOpen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly summary: ReportSnapshotSummary;
  readonly moment: (instant: string) => string;
  readonly person: (summary: ReportSnapshotSummary) => string;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid="report-snapshot-latest">
      <p className="text-body text-text-primary" lang={locale}>
        <bdi>
          {formatMessage(translate(messages, 'reports.snapshots.latestIs'), {
            savedAt: moment(summary.generatedAt),
            person: person(summary),
            moment: moment(summary.asOf),
          })}
        </bdi>
      </p>
      <Button variant="outlined" size="small" onClick={() => onOpen(summary.id)}>
        {translate(messages, 'reports.snapshots.openLatest')}
      </Button>
    </div>
  );
}

const snapshotSignals = (view: ReportSnapshotRows) => ({
  nextCursor: view.rows.nextCursor,
  hasMore: view.rows.hasMore,
});

/** One snapshot: its banner, its restatement links, its difference and its frozen rows. */
function SnapshotView({
  locale,
  messages,
  reportCode,
  snapshotId,
  zone,
  canRestate,
  restateAsOf,
  selection,
  renderRows,
  onOpen,
  onRetry,
  onClose,
  onRestated,
  onListMoved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly snapshotId: string;
  readonly zone: string;
  /** The operator may restate (`rpt.report.configure`, and a moment is shown). */
  readonly canRestate: boolean;
  readonly restateAsOf: string | null;
  readonly selection: ReportScopeSelection;
  readonly renderRows: (columns: readonly ReportColumn[], rows: readonly ReportRow[]) => ReactNode;
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
  readonly onRestated: (id: string) => void;
  /** A refusal showed the list is behind the server: read it again. */
  readonly onListMoved: () => void;
}) {
  const read = useCallback(
    (cursor: string | null) =>
      readReportSnapshot({ reportCode, snapshotId, cursor, limit: REPORT_PAGE_SIZE }),
    [reportCode, snapshotId]
  );
  const trail = useCursorTrail<ReportSnapshotRows>(read, snapshotSignals);
  const [restating, setRestating] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [latest, setLatest] = useState<ReportSnapshotSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sending = useRef(false);

  // A typed reason is work the operator would lose: a branch switch or leaving
  // the page asks first, and discarding it closes the dialog.
  const closeRestate = useCallback(() => {
    setRestating(false);
    setReason('');
    setReasonError(undefined);
    setRefusal(undefined);
    setLatest(null);
  }, []);
  useUnsavedGuard(restating && reason.trim().length > 0, closeRestate);
  const formRef = useFocusFirstInvalid({
    status: reasonError === undefined ? 'idle' : 'invalid',
    attempt,
    ...(reasonError === undefined ? {} : { fieldErrors: { reason: reasonError } }),
  });

  const moment = (instant: string): string => formatReportTime(instant, locale, zone);
  const personOf = (summary: ReportSnapshotSummary): string =>
    summary.generatedBy.displayName ?? translate(messages, 'reports.snapshots.nameHidden');

  if (trail.loading || trail.outcome === null) {
    return (
      <MuiLoadingState messages={messages} variant="inline" testId="report-snapshot-loading" />
    );
  }
  if (trail.outcome.status !== 'ok') {
    return (
      <MuiReadFailureState
        messages={messages}
        locale={locale}
        status={trail.outcome.status}
        correlationId={trail.outcome.correlationId}
        onRetry={onRetry}
        testId="report-snapshot-failed"
      />
    );
  }
  const view = trail.outcome.data;
  const snapshot = view.snapshot;
  // Only the head of its chain may be restated: the server's own answer says
  // whether anything restated this one, whatever the list showed.
  const restatable = canRestate && view.restatedBy === null;

  async function restate(): Promise<void> {
    if (sending.current) return;
    const clean = reason.trim();
    if (!clean || clean.length > MAX_RESTATEMENT_REASON) {
      setReasonError(translate(messages, 'reports.snapshots.reasonRequired'));
      setAttempt((value) => value + 1);
      return;
    }
    if (restateAsOf === null) return;
    sending.current = true;
    setPending(true);
    setRefusal(undefined);
    setLatest(null);
    try {
      const result = await saveReportSnapshot(reportCode, {
        ...selection,
        asOf: restateAsOf,
        restatesSnapshotId: snapshot.id,
        reason: clean,
      });
      if (result.status === 'success' && result.saved) {
        notifyActionResult(result, messages);
        setRestating(false);
        setReason('');
        onRestated(result.saved.id);
        return;
      }
      const onField = result.fieldErrors?.['reason'];
      if (onField !== undefined) {
        setReasonError(translateWithValues(messages, onField, result.messageValues));
        setAttempt((value) => value + 1);
        return;
      }
      setRefusal(refusalSentence(messages, result));
      if (isTakenRefusal(result)) {
        onListMoved();
        const page = await listReportSnapshots({
          reportCode,
          companyId: selection.companyId,
          branchId: selection.branchId,
          from: selection.from,
          to: selection.to,
          cursor: null,
          limit: 1,
        });
        setLatest(page.status === 'ok' ? (page.data.items[0] ?? null) : null);
      }
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <article
      aria-labelledby="report-snapshot-banner"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      data-testid="report-snapshot-view"
    >
      <p
        id="report-snapshot-banner"
        className="text-body font-medium text-text-primary"
        data-testid="report-snapshot-banner"
        lang={locale}
      >
        <bdi>
          {formatMessage(translate(messages, 'reports.snapshots.banner'), {
            moment: moment(snapshot.asOf),
            savedAt: moment(snapshot.generatedAt),
            person: personOf(snapshot),
          })}
        </bdi>
      </p>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.snapshots.frozenNote')}
      </p>

      {view.restatedBy === null ? null : (
        <div
          role="note"
          className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3"
          data-testid="report-snapshot-restated"
        >
          <p className="text-body text-text-primary" lang={locale}>
            <bdi>
              {formatMessage(translate(messages, 'reports.snapshots.restatedBanner'), {
                date: moment(view.restatedBy.generatedAt),
                person: personOf(view.restatedBy),
                reason: view.restatedBy.restatementReason ?? '',
              })}
            </bdi>
          </p>
          <div>
            <Button
              variant="outlined"
              size="small"
              onClick={() => onOpen(view.restatedBy?.id ?? snapshot.id)}
            >
              {translate(messages, 'reports.snapshots.showNewer')}
            </Button>
          </div>
        </div>
      )}

      {view.restates === null ? null : (
        <div
          role="note"
          className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3"
          data-testid="report-snapshot-restates"
        >
          <p className="text-body text-text-primary" lang={locale}>
            <bdi>
              {formatMessage(translate(messages, 'reports.snapshots.restatesBanner'), {
                date: moment(view.restates.generatedAt),
                person: personOf(view.restates),
                reason: snapshot.restatementReason ?? '',
              })}
            </bdi>
          </p>
          <div>
            <Button
              variant="outlined"
              size="small"
              onClick={() => onOpen(view.restates?.id ?? snapshot.id)}
            >
              {translate(messages, 'reports.snapshots.showOlder')}
            </Button>
          </div>
        </div>
      )}

      {snapshot.difference === null ? null : (
        <section
          aria-labelledby="report-snapshot-difference"
          className="flex flex-col gap-2"
          data-testid="report-snapshot-difference"
        >
          <h5 id="report-snapshot-difference" className="text-body font-medium text-text-primary">
            {translate(messages, 'reports.snapshots.difference.heading')}
          </h5>
          <p className="text-body text-text-primary" lang={locale}>
            {formatMessage(translate(messages, 'reports.snapshots.difference.rows'), {
              added: String(snapshot.difference.rowsAdded),
              removed: String(snapshot.difference.rowsRemoved),
              changed: String(snapshot.difference.rowsChanged),
            })}
          </p>
          {snapshot.difference.totals.length === 0 ? null : (
            <TableContainer className="rounded-lg border border-border">
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'reports.snapshots.difference.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'reports.snapshots.difference.currency')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'reports.snapshots.difference.amount')}
                    </TableCell>
                    <TableCell scope="col" className="text-end">
                      {translate(messages, 'reports.snapshots.difference.before')}
                    </TableCell>
                    <TableCell scope="col" className="text-end">
                      {translate(messages, 'reports.snapshots.difference.after')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {snapshot.difference.totals.map((total) => {
                    const heading = fieldHeading(messages, total.measure);
                    return (
                      <TableRow key={`${total.currency ?? ''}|${total.measure}`}>
                        <TableCell>
                          <span dir="ltr">{total.currency ?? ''}</span>
                        </TableCell>
                        <TableCell>
                          {heading === null ? <MachineName value={total.measure} /> : heading}
                        </TableCell>
                        <TableCell className="text-end">
                          <Amount
                            messages={messages}
                            locale={locale}
                            value={total.before}
                            currency={total.currency}
                          />
                        </TableCell>
                        <TableCell className="text-end">
                          <Amount
                            messages={messages}
                            locale={locale}
                            value={total.after}
                            currency={total.currency}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </section>
      )}

      {view.rows.items.length === 0 ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.run.noRows')}
        </p>
      ) : (
        renderRows(view.columns, view.rows.items)
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outlined" disabled={!trail.canGoBack} onClick={trail.goBack}>
          {translate(messages, 'reports.page.previous')}
        </Button>
        <Button variant="outlined" disabled={!trail.canGoForward} onClick={trail.goForward}>
          {translate(messages, 'reports.page.next')}
        </Button>
        {restatable ? (
          <Button
            variant="contained"
            onClick={() => {
              setRefusal(undefined);
              setReasonError(undefined);
              setLatest(null);
              setRestating(true);
            }}
          >
            {translate(messages, 'reports.snapshots.restate')}
          </Button>
        ) : null}
        <Button variant="text" onClick={onClose}>
          {translate(messages, 'reports.snapshots.close')}
        </Button>
      </div>

      {restating ? (
        <ReportFormDialog
          title={translate(messages, 'reports.snapshots.restateTitle')}
          description={translate(messages, 'reports.snapshots.restateExplain')}
          submitLabel={translate(messages, 'reports.snapshots.restateConfirm')}
          pendingLabel={translate(messages, 'reports.snapshots.saving')}
          cancelLabel={translate(messages, 'reports.snapshots.restateCancel')}
          pending={pending}
          error={refusal}
          refusalDetail={
            latest === null ? null : (
              <LatestSnapshot
                locale={locale}
                messages={messages}
                summary={latest}
                moment={moment}
                person={personOf}
                onOpen={(id) => {
                  closeRestate();
                  onOpen(id);
                }}
              />
            )
          }
          formRef={formRef}
          testId="report-snapshot-restate"
          onCancel={() => {
            if (pending) return;
            closeRestate();
          }}
          onSubmit={() => {
            void restate();
          }}
        >
          <FormTextField
            label={translate(messages, 'reports.snapshots.reason')}
            name="reason"
            required
            multiline
            rows={3}
            autoFocus
            maxLength={MAX_RESTATEMENT_REASON}
            value={reason}
            disabled={pending}
            error={reasonError}
            onEdit={() => setReasonError(undefined)}
            onChange={setReason}
          />
        </ReportFormDialog>
      ) : null}
    </article>
  );
}

function Amount({
  messages,
  locale,
  value,
  currency,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly value: string | null;
  readonly currency: string | null;
}) {
  return value === null ? (
    <span className="text-text-muted" lang={locale}>
      {translate(messages, 'reports.cell.none')}
    </span>
  ) : (
    <span dir="ltr">{formatReportMoney(value, currency, locale)}</span>
  );
}

/**
 * The sentence a refused save or restatement is told in: the rule the server named
 * where it named one this build words, otherwise the state's own heading.
 */
function refusalSentence(messages: Messages, state: ActionState): string {
  return translateWithValues(messages, state.messageKey ?? 'action.failed', state.messageValues);
}
