'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { TextAreaField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
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
import {
  MachineName,
  REPORT_PRIMARY_BUTTON,
  REPORT_SECONDARY_BUTTON,
  REPORT_TABLE_CELL,
  REPORT_TABLE_HEADER,
  ReportFailure,
  ReportLoading,
} from './ReportShell';
import { useCursorTrail } from './use-cursor-trail';

/**
 * Saved snapshots of the report on the screen (Owner decision D16,
 * P1-32-PRE-OD-FD16B).
 *
 * The report above is recomputed every time it is read, as of the moment it
 * states. A snapshot keeps ONE such reading, exactly as it was, for this branch
 * and period: a payment, credit or reversal recorded later never changes it. To
 * correct one, the latest snapshot is RESTATED with a reason — a new snapshot that
 * names the one it replaces and says what changed; the earlier one is kept and
 * says it was restated.
 *
 * Saving and restating are offered only to an operator holding the export
 * permission, which is what the backend requires; reading needs only the report.
 * Every figure here is the server's: nothing is computed in the browser.
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
  /** Whether the save and restate actions are offered (`rpt.export`). */
  readonly canSave: boolean;
  /** The report's own row table, so a frozen row reads exactly as a live one. */
  readonly renderRows: (columns: readonly ReportColumn[], rows: readonly ReportRow[]) => ReactNode;
}) {
  const [refresh, setRefresh] = useState(0);
  const [listed, setListed] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ok'; readonly items: readonly ReportSnapshotSummary[] }
    | { readonly status: 'failed'; readonly state: Awaited<ReturnType<typeof listReportSnapshots>> }
  >({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const { companyId, branchId, from, to } = selection;
  useEffect(() => {
    let cancelled = false;
    void listReportSnapshots({
      reportCode,
      companyId,
      branchId,
      from,
      to,
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    }).then((state) => {
      if (cancelled) return;
      setListed(
        state.status === 'ok'
          ? { status: 'ok', items: state.data.items }
          : { status: 'failed', state }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [reportCode, companyId, branchId, from, to, refresh]);

  const latest =
    listed.status === 'ok'
      ? (listed.items.find((item) => item.restatedBySnapshotId === null) ?? null)
      : null;

  async function save(): Promise<void> {
    if (asOf === null) return;
    setPending(true);
    setRefusal(undefined);
    try {
      const result = await saveReportSnapshot(reportCode, { ...selection, asOf });
      if (!alive.current) return;
      if (result.status === 'success' && result.saved) {
        notifyActionResult(result, messages);
        setAsking(false);
        setSelected(result.saved.id);
        setRefresh((value) => value + 1);
        return;
      }
      setRefusal(refusalSentence(messages, result));
    } finally {
      if (alive.current) setPending(false);
    }
  }

  const person = (summary: ReportSnapshotSummary): string =>
    summary.generatedBy.displayName ?? translate(messages, 'reports.snapshots.nameHidden');
  const moment = (instant: string): string => formatReportTime(instant, locale, zone);

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
          <button
            type="button"
            className={REPORT_PRIMARY_BUTTON}
            onClick={() => {
              setRefusal(undefined);
              setAsking(true);
            }}
          >
            {translate(messages, 'reports.snapshots.save')}
          </button>
        </div>
      ) : null}

      {listed.status === 'loading' ? <ReportLoading messages={messages} /> : null}
      {listed.status === 'failed' ? (
        <p role="status" className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.snapshots.unavailable')}
        </p>
      ) : null}
      {listed.status === 'ok' && listed.items.length === 0 ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.snapshots.none')}
        </p>
      ) : null}
      {listed.status === 'ok' && listed.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse" data-testid="report-snapshot-list">
            <caption className="sr-only">
              {translate(messages, 'reports.snapshots.listCaption')}
            </caption>
            <thead className="bg-table-header">
              <tr>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  {translate(messages, 'reports.snapshots.column.savedAt')}
                </th>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  {translate(messages, 'reports.snapshots.column.savedBy')}
                </th>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  {translate(messages, 'reports.snapshots.column.asOf')}
                </th>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  {translate(messages, 'reports.snapshots.column.rows')}
                </th>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  {translate(messages, 'reports.snapshots.column.kind')}
                </th>
                <th scope="col" className={REPORT_TABLE_HEADER}>
                  <span className="sr-only">
                    {translate(messages, 'reports.snapshots.column.open')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-border-subtle"
                  data-testid="report-snapshot-item"
                >
                  <td className={REPORT_TABLE_CELL}>
                    <time dateTime={item.generatedAt}>{moment(item.generatedAt)}</time>
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    <bdi>{person(item)}</bdi>
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    <time dateTime={item.asOf}>{moment(item.asOf)}</time>
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    <span dir="ltr">{String(item.rowCount)}</span>
                  </td>
                  <td className={REPORT_TABLE_CELL} lang={locale}>
                    {translate(
                      messages,
                      item.restatesSnapshotId === null
                        ? 'reports.snapshots.kind.original'
                        : 'reports.snapshots.kind.restatement'
                    )}
                    {item.restatedBySnapshotId === null ? null : (
                      <span className="ms-2 text-caption text-text-muted">
                        {translate(messages, 'reports.snapshots.kind.restated')}
                      </span>
                    )}
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    <button
                      type="button"
                      className={REPORT_SECONDARY_BUTTON}
                      aria-pressed={selected === item.id}
                      onClick={() => setSelected(item.id)}
                    >
                      {translate(messages, 'reports.snapshots.view')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected === null ? null : (
        <SnapshotView
          key={selected}
          locale={locale}
          messages={messages}
          reportCode={reportCode}
          snapshotId={selected}
          zone={zone}
          canRestate={canSave && asOf !== null && latest?.id === selected}
          restateAsOf={asOf}
          selection={selection}
          renderRows={renderRows}
          onOpen={setSelected}
          onClose={() => setSelected(null)}
          onRestated={(id) => {
            setSelected(id);
            setRefresh((value) => value + 1);
          }}
        />
      )}

      <ConfirmDialog
        open={asking}
        messages={messages}
        title={translate(messages, 'reports.snapshots.saveTitle')}
        description={formatMessage(translate(messages, 'reports.snapshots.saveSummary'), {
          company: companyName ?? '',
          branch: branchName ?? '',
          from,
          to,
          moment: asOfMoment ?? '',
        })}
        confirmLabel={translate(messages, 'reports.snapshots.saveConfirm')}
        pending={pending}
        error={refusal}
        testId="report-snapshot-save-dialog"
        onCancel={() => {
          if (!pending) setAsking(false);
        }}
        onConfirm={() => {
          void save();
        }}
      />
    </section>
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
  onClose,
  onRestated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly snapshotId: string;
  readonly zone: string;
  readonly canRestate: boolean;
  readonly restateAsOf: string | null;
  readonly selection: ReportScopeSelection;
  readonly renderRows: (columns: readonly ReportColumn[], rows: readonly ReportRow[]) => ReactNode;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  readonly onRestated: (id: string) => void;
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
  const [pending, setPending] = useState(false);

  if (trail.loading || trail.outcome === null) return <ReportLoading messages={messages} />;
  if (trail.outcome.status !== 'ok') {
    return (
      <ReportFailure
        messages={messages}
        status={trail.outcome.status}
        correlationId={trail.outcome.correlationId}
      />
    );
  }
  const view = trail.outcome.data;
  const snapshot = view.snapshot;
  const moment = (instant: string): string => formatReportTime(instant, locale, zone);
  const person = (name: string | null): string =>
    name ?? translate(messages, 'reports.snapshots.nameHidden');

  async function restate(): Promise<void> {
    const clean = reason.trim();
    if (!clean || clean.length > MAX_RESTATEMENT_REASON) {
      setReasonError(translate(messages, 'reports.snapshots.reasonRequired'));
      return;
    }
    if (restateAsOf === null) return;
    setPending(true);
    setRefusal(undefined);
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
        onRestated(result.saved.id);
        return;
      }
      setRefusal(refusalSentence(messages, result));
    } finally {
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
            person: person(snapshot.generatedBy.displayName),
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
                person: person(view.restatedBy.generatedBy.displayName),
                reason: view.restatedBy.restatementReason ?? '',
              })}
            </bdi>
          </p>
          <div>
            <button
              type="button"
              className={REPORT_SECONDARY_BUTTON}
              onClick={() => onOpen(view.restatedBy?.id ?? snapshot.id)}
            >
              {translate(messages, 'reports.snapshots.showNewer')}
            </button>
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
                person: person(view.restates.generatedBy.displayName),
                reason: snapshot.restatementReason ?? '',
              })}
            </bdi>
          </p>
          <div>
            <button
              type="button"
              className={REPORT_SECONDARY_BUTTON}
              onClick={() => onOpen(view.restates?.id ?? snapshot.id)}
            >
              {translate(messages, 'reports.snapshots.showOlder')}
            </button>
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
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <caption className="sr-only">
                  {translate(messages, 'reports.snapshots.difference.caption')}
                </caption>
                <thead className="bg-table-header">
                  <tr>
                    <th scope="col" className={REPORT_TABLE_HEADER}>
                      {translate(messages, 'reports.snapshots.difference.currency')}
                    </th>
                    <th scope="col" className={REPORT_TABLE_HEADER}>
                      {translate(messages, 'reports.snapshots.difference.amount')}
                    </th>
                    <th scope="col" className={REPORT_TABLE_HEADER}>
                      {translate(messages, 'reports.snapshots.difference.before')}
                    </th>
                    <th scope="col" className={REPORT_TABLE_HEADER}>
                      {translate(messages, 'reports.snapshots.difference.after')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.difference.totals.map((total) => {
                    const heading = fieldHeading(messages, total.measure);
                    return (
                      <tr
                        key={`${total.currency ?? ''}|${total.measure}`}
                        className="border-t border-border-subtle"
                      >
                        <td className={REPORT_TABLE_CELL}>
                          <span dir="ltr">{total.currency ?? ''}</span>
                        </td>
                        <td className={REPORT_TABLE_CELL}>
                          {heading === null ? <MachineName value={total.measure} /> : heading}
                        </td>
                        <td className={REPORT_TABLE_CELL}>
                          <Amount
                            messages={messages}
                            locale={locale}
                            value={total.before}
                            currency={total.currency}
                          />
                        </td>
                        <td className={REPORT_TABLE_CELL}>
                          <Amount
                            messages={messages}
                            locale={locale}
                            value={total.after}
                            currency={total.currency}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
        <button
          type="button"
          className={REPORT_SECONDARY_BUTTON}
          disabled={!trail.canGoBack}
          onClick={trail.goBack}
        >
          {translate(messages, 'reports.page.previous')}
        </button>
        <button
          type="button"
          className={REPORT_SECONDARY_BUTTON}
          disabled={!trail.canGoForward}
          onClick={trail.goForward}
        >
          {translate(messages, 'reports.page.next')}
        </button>
        {canRestate && view.restatedBy === null ? (
          <button
            type="button"
            className={REPORT_SECONDARY_BUTTON}
            onClick={() => {
              setRefusal(undefined);
              setReasonError(undefined);
              setRestating(true);
            }}
          >
            {translate(messages, 'reports.snapshots.restate')}
          </button>
        ) : null}
        <button type="button" className={REPORT_SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'reports.snapshots.close')}
        </button>
      </div>

      {restating ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-border p-3"
          aria-labelledby="report-snapshot-restate-heading"
          data-testid="report-snapshot-restate"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void restate();
          }}
        >
          <p
            id="report-snapshot-restate-heading"
            className="text-body font-medium text-text-primary"
          >
            {translate(messages, 'reports.snapshots.restateTitle')}
          </p>
          <p className="text-caption text-text-secondary" lang={locale}>
            {translate(messages, 'reports.snapshots.restateExplain')}
          </p>
          <TextAreaField
            label={translate(messages, 'reports.snapshots.reason')}
            required
            maxLength={MAX_RESTATEMENT_REASON}
            value={reason}
            disabled={pending}
            error={reasonError}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(undefined);
            }}
          />
          {refusal === undefined ? null : (
            <p role="alert" className="text-body text-error" lang={locale}>
              {refusal}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={REPORT_PRIMARY_BUTTON} disabled={pending}>
              {translate(messages, 'reports.snapshots.restateConfirm')}
            </button>
            <button
              type="button"
              className={REPORT_SECONDARY_BUTTON}
              disabled={pending}
              onClick={() => setRestating(false)}
            >
              {translate(messages, 'reports.snapshots.restateCancel')}
            </button>
          </div>
        </form>
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
