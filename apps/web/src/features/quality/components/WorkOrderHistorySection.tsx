'use client';

/**
 * The unified history of one work order (P1-29 W6 read, consumed by W8):
 * `wo.work-order-timeline`, one keyset page at a time, newest first, with the
 * kinds withheld from THIS caller named. A history with declared gaps is what
 * the operation publishes; this section renders exactly that and never fills a
 * gap in.
 *
 * ## Said in words, never as the codes the read carries (DEF-R1)
 *
 * Browser QA at 305e79c8 (DEF-R1) found every move printed in monospace as the
 * read carries it — "work_order_status", "ready_to_close → closed" — in English
 * and inside the Arabic page. Each entry is now said in the reader's language:
 *
 *   - the KIND through the timeline's closed vocabulary (`TIMELINE_KINDS` in
 *     `server/db/timeline.ts`), an unknown kind as "Recorded";
 *   - the STATES through the vocabulary of the thing that moved — a work
 *     order's through `workOrderStateLabel`, a job's through `jobStateLabel`, a
 *     diagnostic's and a quality check's through their own catalogue entries —
 *     a code a workshop added keeping its code, as everywhere else;
 *   - the JOB a job-level entry belongs to by its title, from the jobs the
 *     detail already holds, never by its reference;
 *   - the withheld kinds by what they are, without the permission code that
 *     would show them — a code is not something an operator can act on.
 *
 * The actor is not drawn: the read publishes the actor's identifier and no
 * name, and an identifier is not a person.
 *
 * ## States
 *
 * A failed read is the state it is (`MuiReadFailureState`) — an outage with a
 * retry, a refusal without one — and "Show earlier history" walks the cursor
 * the page handed back, disabled while the next page is read.
 */
import Button from '@mui/material/Button';
import { useCallback, useEffect, useState } from 'react';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import {
  assignmentRoleLabel,
  jobStateLabel,
  workOrderStateLabel,
} from '@/features/work-orders/work-orders-contract';
import { readWorkOrderTimeline } from '../api';
import type { WorkOrderTimelineEntry, WorkOrderTimelinePage } from '../quality-contract';

/** `TIMELINE_KINDS` — the timeline's closed vocabulary. */
const TIMELINE_KINDS = [
  'work_order_status',
  'job_status',
  'assignment',
  'assignment_ended',
  'labor_session',
  'labor_session_ended',
  'work_log',
  'evidence',
  'blocker_raised',
  'blocker_resolved',
  'diagnostic_status',
  'qc_status',
] as const;

const DIAGNOSTIC_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'];
/** `qms.qc_status_history`'s CHECK vocabulary; `pending` is the open check. */
const QC_STATUS_KEYS: Readonly<Record<string, string>> = {
  pending: 'quality.result.open',
  passed: 'quality.result.passed',
  failed: 'quality.result.failed',
};

/** The name of a timeline kind in the reader's language. */
export function timelineKindText(messages: Messages, kind: string): string {
  return (TIMELINE_KINDS as readonly string[]).includes(kind)
    ? translateDynamic(messages, `workOrders.history.kind.${kind}`)
    : translate(messages, 'workOrders.history.kind.other');
}

/** A state an entry moved from or to, in the vocabulary of what moved. */
export function timelineStateText(messages: Messages, kind: string, code: string): string {
  const t = (key: string) => translateDynamic(messages, key);
  switch (kind) {
    case 'work_order_status':
      return workOrderStateLabel(code, [], t);
    case 'job_status':
      return jobStateLabel(code, t);
    case 'diagnostic_status':
      return DIAGNOSTIC_STATUSES.includes(code) ? t(`diagnostics.reportStatus.${code}`) : code;
    case 'qc_status': {
      const key = QC_STATUS_KEYS[code];
      return key === undefined ? code : t(key);
    }
    default:
      return code;
  }
}

/** The move of one entry — "from Ready to close to Closed" — or null when it records none. */
function moveText(messages: Messages, entry: WorkOrderTimelineEntry): string | null {
  if (entry.toState === null) return null;
  const to = timelineStateText(messages, entry.kind, entry.toState);
  return entry.fromState === null
    ? formatMessage(translate(messages, 'workOrders.history.movedTo'), { to })
    : formatMessage(translate(messages, 'workOrders.history.moved'), {
        from: timelineStateText(messages, entry.kind, entry.fromState),
        to,
      });
}

/**
 * The entry's `detail`, where it is something an operator can read: the kind of
 * evidence as it was typed, and an assignment's role in words. The blocker
 * event and the clock's source are codes the kind already says, and are not
 * drawn.
 */
function detailText(messages: Messages, entry: WorkOrderTimelineEntry): string | null {
  if (entry.detail === null || entry.detail.trim() === '') return null;
  if (entry.kind === 'evidence') return entry.detail;
  if (entry.kind === 'assignment' || entry.kind === 'assignment_ended') {
    return assignmentRoleLabel(entry.detail, (key) => translateDynamic(messages, key));
  }
  return null;
}

export function WorkOrderHistorySection({
  locale,
  messages,
  workOrderId,
  reloadCount,
  jobs = [],
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly reloadCount: number;
  /** The order's jobs, so a job-level entry names its job by title. */
  readonly jobs?: readonly { readonly id: string; readonly title: string }[];
}) {
  const [first, setFirst] = useState<{
    readonly workOrderId: string;
    readonly state: ReadState<WorkOrderTimelinePage>;
  } | null>(null);
  const [pages, setPages] = useState<readonly WorkOrderTimelinePage[]>([]);
  const [loading, setLoading] = useState(false);
  const [retries, setRetries] = useState(0);
  const key = `${workOrderId}#${reloadCount}#${retries}`;

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderTimeline(workOrderId, null).then((next) => {
      // A read the section no longer wants — another work order, or a newer
      // re-read — is dropped rather than painted over the newer one.
      if (cancelled) return;
      setFirst({ workOrderId, state: next });
      setPages(next.status === 'ok' ? [next.data] : []);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, key]);

  const retry = useCallback(() => setRetries((n) => n + 1), []);
  // A re-read keeps the last answer on screen; another work order's never is.
  const shown = first !== null && first.workOrderId === workOrderId ? first.state : null;

  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (last === null || !last.hasMore || last.nextCursor === null || loading) return;
    setLoading(true);
    try {
      const next = await readWorkOrderTimeline(workOrderId, last.nextCursor);
      if (next.status === 'ok') setPages((current) => [...current, next.data]);
    } finally {
      setLoading(false);
    }
  };

  const jobTitle = (jobId: string | null): string | null =>
    jobId === null ? null : (jobs.find((job) => job.id === jobId)?.title ?? null);

  return (
    <section
      aria-labelledby="work-order-history-heading"
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="work-order-history"
    >
      <h2
        id="work-order-history-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'workOrders.detail.historyHeading')}
      </h2>
      {shown === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : shown.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={shown.status}
          correlationId={shown.correlationId}
          onRetry={retry}
          descriptionKey="workOrders.history.unavailable"
          testId="work-order-history-failure"
        />
      ) : (
        <>
          {shown.data.omittedKinds.length > 0 ? (
            <p
              className="mb-2 text-caption text-text-muted"
              data-testid="work-order-history-omitted"
            >
              {formatMessage(translate(messages, 'workOrders.history.omitted'), {
                kinds: [...new Set(shown.data.omittedKinds.map((o) => o.kind))]
                  .map((kind) => timelineKindText(messages, kind))
                  .join(', '),
              })}
            </p>
          ) : null}
          {pages[0]?.items.length === 0 ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'workOrders.detail.noHistory')}
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {pages.flatMap((page) =>
                page.items.map((entry) => {
                  const move = moveText(messages, entry);
                  const detail = detailText(messages, entry);
                  const title = jobTitle(entry.jobId);
                  return (
                    <li
                      key={`${entry.kind}-${entry.id}`}
                      className="flex flex-col gap-0.5 text-body text-text-primary"
                      data-kind={entry.kind}
                    >
                      <span>
                        <span className="font-medium">
                          {timelineKindText(messages, entry.kind)}
                        </span>
                        {move === null ? null : <> {move}</>}
                        {detail === null ? null : (
                          <span className="text-text-secondary">
                            {' · '}
                            <bdi>{detail}</bdi>
                          </span>
                        )}
                      </span>
                      {entry.note ? (
                        <span className="text-text-secondary">
                          <bdi>{entry.note}</bdi>
                        </span>
                      ) : null}
                      <span className="text-caption text-text-muted">
                        {title === null ? null : (
                          <>
                            <bdi>
                              {formatMessage(translate(messages, 'workOrders.history.job'), {
                                title,
                              })}
                            </bdi>
                            {' · '}
                          </>
                        )}
                        <bdi>{formatDateTime(entry.occurredAt, locale)}</bdi>
                      </span>
                    </li>
                  );
                })
              )}
            </ol>
          )}
          {last !== null && last.hasMore ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => void loadMore()}
                disabled={loading}
                aria-busy={loading || undefined}
              >
                {translate(messages, loading ? 'state.loading' : 'workOrders.detail.moreHistory')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
