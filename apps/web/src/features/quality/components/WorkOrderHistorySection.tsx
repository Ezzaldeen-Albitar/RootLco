'use client';

/**
 * The unified history of one work order (P1-29 W6 read, consumed by W8):
 * `wo.work-order-timeline`, one keyset page at a time, newest first, with the
 * kinds withheld from THIS caller named alongside the code that would show
 * them. A history with declared gaps is what the operation publishes; this
 * section renders exactly that and never fills a gap in.
 */
import { useEffect, useState } from 'react';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { readWorkOrderTimeline } from '../api';
import type { WorkOrderTimelinePage } from '../quality-contract';

const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

export function WorkOrderHistorySection({
  locale,
  messages,
  workOrderId,
  reloadCount,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly reloadCount: number;
}) {
  const [first, setFirst] = useState<ReadState<WorkOrderTimelinePage> | null>(null);
  const [pages, setPages] = useState<readonly WorkOrderTimelinePage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPages([]);
    void readWorkOrderTimeline(workOrderId, null).then((next) => {
      if (cancelled) return;
      setFirst(next);
      if (next.status === 'ok') setPages([next.data]);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (last === null || !last.hasMore || last.nextCursor === null) return;
    setLoading(true);
    const next = await readWorkOrderTimeline(workOrderId, last.nextCursor);
    setLoading(false);
    if (next.status === 'ok') setPages((current) => [...current, next.data]);
  };

  return (
    <section
      aria-labelledby="work-order-history-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-history-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'workOrders.detail.historyHeading')}
      </h2>
      {first === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : first.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${first.status}.title`)}
          {first.correlationId
            ? ` ${translate(messages, 'action.reference')} ${first.correlationId}`
            : ''}
        </p>
      ) : (
        <>
          {first.data.omittedKinds.length > 0 ? (
            <p className="mb-2 text-caption text-text-muted">
              {translate(messages, 'workOrders.detail.historyOmitted')}{' '}
              {first.data.omittedKinds
                .map(
                  (o) =>
                    `${o.kind} (${translate(messages, 'workOrders.detail.historyRequires')} ${o.requires})`
                )
                .join(', ')}
            </p>
          ) : null}
          {pages[0]?.items.length === 0 ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'workOrders.detail.noHistory')}
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {pages.flatMap((page) =>
                page.items.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`} className="text-body text-text-primary">
                    <code className="font-mono text-caption" dir="ltr">
                      {entry.kind}
                    </code>{' '}
                    {entry.fromState !== null || entry.toState !== null ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {entry.fromState ?? '—'} → {entry.toState ?? '—'}
                      </code>
                    ) : null}
                    {entry.note ? (
                      <>
                        {' '}
                        <bdi>{entry.note}</bdi>
                      </>
                    ) : null}
                    {entry.detail ? (
                      <span className="text-caption text-text-secondary">
                        {' '}
                        <bdi>{entry.detail}</bdi>
                      </span>
                    ) : null}
                    <span className="text-caption text-text-muted">
                      {' '}
                      · {formatDateTime(entry.occurredAt, locale)}
                    </span>
                  </li>
                ))
              )}
            </ol>
          )}
          {last !== null && last.hasMore ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className={SECONDARY_BUTTON}
              >
                {translate(messages, loading ? 'state.loading' : 'workOrders.detail.moreHistory')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
