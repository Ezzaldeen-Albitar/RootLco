'use client';

import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { DeliveryRecord } from '../delivery-contract';
import { ChecklistResultsPanel } from './ChecklistResultsPanel';
import { StatusLabel } from './CodeLabel';
import { EligibilityPanel } from './EligibilityPanel';
import { Fact, Panel, Reference } from './PanelShell';
import { ReceiverPanel } from './ReceiverPanel';
import { SignaturesPanel } from './SignaturesPanel';
import { StatusHistoryPanel } from './StatusHistoryPanel';

/**
 * One vehicle handover, end to end (P1-31, FE-002, FE-003, FE-004, FE-006,
 * FE-007).
 *
 * ## Read-only, and it says so by having no controls
 *
 * This slice publishes the custody chain and changes nothing. There is no
 * button here that writes: verifying the receiver, recording a checklist result,
 * attaching a signature and completing the handover each have their own
 * authority and their own screen still to come. A control that submits nothing
 * is worse than an absent one, so none is drawn.
 *
 * ## The record is read on the server, the panels read for themselves
 *
 * The route page reads the delivery record after it has decided the operator may
 * see one, so this screen starts loaded rather than blank. Each panel then reads
 * its own subresource, which is what lets one refusal or one outage stay inside
 * one panel instead of taking the screen with it.
 *
 * ## Identifiers are shown as identifiers
 *
 * The vehicle, the visit, the delivering employee and the receiving partner are
 * all bare identifiers in the platform, and this screen resolves none of them. A
 * name invented on this side would be the second, rotting authority on who a
 * person is. The work order is the exception, because a work-order screen exists
 * and can be linked to.
 */
export function DeliveryDetailScreen({
  locale,
  messages,
  delivery,
  canReadFinance,
  canComplete,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The page's own read. */
  readonly delivery: DeliveryRecord;
  readonly canReadFinance: boolean;
  readonly canComplete: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-6">
      <Panel
        headingId="delivery-summary-heading"
        titleKey="delivery.summary.heading"
        messages={messages}
      >
        <div className="flex flex-col gap-3">
          <Fact label={translate(messages, 'delivery.summary.status')}>
            <span
              data-status={delivery.status}
              className="rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-caption text-text-primary"
            >
              <StatusLabel messages={messages} status={delivery.status} />
            </span>
          </Fact>

          <Fact label={translate(messages, 'delivery.summary.deliveredAt')}>
            {delivery.deliveredAt === null
              ? translate(messages, 'delivery.summary.notDeliveredYet')
              : formatDateTime(delivery.deliveredAt, locale)}
          </Fact>

          <p className="text-body">
            <Link
              href={`/${locale}/work-orders/${delivery.workOrderId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {translate(messages, 'delivery.summary.workOrderLink')}
            </Link>
          </p>

          <Reference
            label={translate(messages, 'delivery.summary.vehicle')}
            value={delivery.vehicleId}
          />
          <Reference
            label={translate(messages, 'delivery.summary.visit')}
            value={delivery.receptionVisitId}
          />
          <Reference
            label={translate(messages, 'delivery.summary.deliveringEmployee')}
            value={delivery.deliveringEmployeeId}
          />
          <Reference
            label={translate(messages, 'delivery.summary.finalOdometerReading')}
            value={delivery.finalOdometerReadingId}
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'delivery.summary.identifiersExplain')}
          </p>
        </div>
      </Panel>

      <EligibilityPanel
        messages={messages}
        deliveryId={delivery.id}
        canReadFinance={canReadFinance}
        canComplete={canComplete}
      />

      <ReceiverPanel locale={locale} messages={messages} deliveryId={delivery.id} />

      <SignaturesPanel locale={locale} messages={messages} deliveryId={delivery.id} />

      <ChecklistResultsPanel messages={messages} deliveryId={delivery.id} />

      <StatusHistoryPanel locale={locale} messages={messages} deliveryId={delivery.id} />
    </div>
  );
}
