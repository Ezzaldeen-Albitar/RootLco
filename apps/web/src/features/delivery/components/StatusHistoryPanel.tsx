'use client';

import { EmptyState } from '@/components/states/States';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listStatusHistory } from '../api';
import type { DeliveryStatusHistoryEnvelope, DeliveryStatusTransition } from '../delivery-contract';
import { StatusLabel } from './CodeLabel';
import { Panel, PanelFailure, PanelLoading, Reference, SECONDARY_BUTTON } from './PanelShell';
import { usePagedList } from './use-paged-list';

/**
 * Every move this handover has made (FE-007), newest first.
 *
 * The ledger is append-only and it is written on every transition, so this is
 * the one place the whole custody chain can be read in order. It was written and
 * read nowhere until this panel existed.
 *
 * The first transition has no previous state, which is a fact about a beginning
 * rather than a missing value, so it is drawn as a start rather than as a gap.
 * The actor is an identifier the platform does not resolve to a person, and it
 * is shown as the reference it is.
 */
const selectTransitions = (envelope: DeliveryStatusHistoryEnvelope) => envelope.transitions;

export function StatusHistoryPanel({
  locale,
  messages,
  deliveryId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
}) {
  const page = usePagedList<DeliveryStatusHistoryEnvelope, DeliveryStatusTransition>(
    deliveryId,
    listStatusHistory,
    selectTransitions
  );

  return (
    <Panel
      headingId="delivery-history-heading"
      titleKey="delivery.history.heading"
      messages={messages}
    >
      {page.first === null ? (
        <PanelLoading messages={messages} />
      ) : page.first.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={page.first.status}
          correlationId={page.first.correlationId}
        />
      ) : page.rows.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="delivery.history.noneTitle"
          descriptionKey="delivery.history.noneDescription"
        />
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {page.rows.map((transition) => (
              <li
                key={transition.id}
                className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
              >
                <span className="font-medium">
                  {transition.fromStatus === null
                    ? translate(messages, 'delivery.history.started')
                    : translate(messages, 'delivery.history.movedFrom')}{' '}
                  {transition.fromStatus === null ? null : (
                    <>
                      <StatusLabel messages={messages} status={transition.fromStatus} />{' '}
                      {translate(messages, 'delivery.history.movedTo')}{' '}
                    </>
                  )}
                  <StatusLabel messages={messages} status={transition.toStatus} />
                </span>{' '}
                <span className="text-caption text-text-secondary">
                  {formatDateTime(transition.occurredAt, locale)}
                </span>
                {transition.reason === null ? null : (
                  <p className="text-caption text-text-muted">
                    <bdi>{transition.reason}</bdi>
                  </p>
                )}
                <div className="mt-1">
                  <Reference
                    label={translate(messages, 'delivery.history.actor')}
                    value={transition.actorId}
                  />
                </div>
              </li>
            ))}
          </ol>
          {page.moreFailed === null ? null : (
            <p role="alert" className="mt-2 text-body text-error">
              {translateDynamic(messages, `state.${page.moreFailed}.title`)}
            </p>
          )}
          {page.hasMore ? (
            <button
              type="button"
              className={`mt-3 ${SECONDARY_BUTTON}`}
              disabled={page.loading}
              onClick={() => void page.loadMore()}
            >
              {translate(messages, 'delivery.action.loadMore')}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}
