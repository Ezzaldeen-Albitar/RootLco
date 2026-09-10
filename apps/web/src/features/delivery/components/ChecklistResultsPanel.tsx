'use client';

import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listChecklistResults } from '../api';
import type { ChecklistResult, DeliveryChecklistResultsEnvelope } from '../delivery-contract';
import { OutcomeLabel } from './CodeLabel';
import { Panel, PanelFailure, PanelLoading, SECONDARY_BUTTON } from './PanelShell';
import { usePagedList } from './use-paged-list';

/**
 * The checklist results recorded against this handover (FE-004, results only).
 *
 * ## This is the RESULTS list and not the checklist
 *
 * The template that decides which items exist has no read surface at all, so no
 * screen can yet show "the checklist" — the items that were never recorded are
 * not knowable from here. What this panel shows is exactly what was recorded,
 * and the eligibility panel is where the unsatisfied MANDATORY items appear,
 * because that read is the only one that publishes them. Drawing this list as if
 * it were the whole checklist would claim completeness the platform cannot back.
 *
 * ## A waiver states its reason
 *
 * A waived item carries the reason it was waived, and the reason is rendered
 * beside the outcome. A waiver without a visible reason is an audit trail that
 * exists and cannot be read.
 */
const selectResults = (envelope: DeliveryChecklistResultsEnvelope) => envelope.results;

export function ChecklistResultsPanel({
  messages,
  deliveryId,
}: {
  readonly messages: Messages;
  readonly deliveryId: string;
}) {
  const page = usePagedList<DeliveryChecklistResultsEnvelope, ChecklistResult>(
    deliveryId,
    listChecklistResults,
    selectResults
  );

  return (
    <Panel
      headingId="delivery-checklist-heading"
      titleKey="delivery.checklist.heading"
      messages={messages}
      description={translate(messages, 'delivery.checklist.resultsOnly')}
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
          titleKey="delivery.checklist.noneTitle"
          descriptionKey="delivery.checklist.noneDescription"
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {page.rows.map((result) => (
              <li
                key={result.id}
                className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
              >
                <bdi className="font-medium">{result.label}</bdi>{' '}
                <code className="font-mono text-caption text-text-secondary" dir="ltr">
                  {result.itemCode}
                </code>
                <p className="text-caption text-text-secondary">
                  <OutcomeLabel messages={messages} outcome={result.outcome} />
                </p>
                {result.waiverReason === null ? null : (
                  <p className="text-caption text-text-muted">
                    {translate(messages, 'delivery.checklist.waiverReason')}{' '}
                    <bdi>{result.waiverReason}</bdi>
                  </p>
                )}
              </li>
            ))}
          </ul>
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
