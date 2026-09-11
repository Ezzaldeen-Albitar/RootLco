'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { GenerateWarrantyPanel } from '@/features/warranty/components/GenerateWarrantyPanel';
import type { DeliveryRecord } from '../delivery-contract';
import { ChecklistResultsPanel } from './ChecklistResultsPanel';
import { StatusLabel } from './CodeLabel';
import { CompletionPanel } from './CompletionPanel';
import { EligibilityPanel } from './EligibilityPanel';
import { Fact, Panel, Reference } from './PanelShell';
import { ReceiverPanel } from './ReceiverPanel';
import { SignaturesPanel } from './SignaturesPanel';
import { StatusHistoryPanel } from './StatusHistoryPanel';
import { useEligibility } from './use-eligibility';

/**
 * One vehicle handover, end to end (P1-31, FE-002, FE-003, FE-004, FE-006,
 * FE-007).
 *
 * ## Every control is gated on the code ITS OWN operation declares
 *
 * Not on one screen-wide capability. Verifying a receiver, recording a checklist
 * outcome and binding a signature declare `sal.delivery.manage`; completing the
 * handover declares `sal.delivery.complete` alongside the financial read code.
 * A caller holding one and not the other sees exactly the controls they can use,
 * and the others are ABSENT rather than present-and-refused: a button whose only
 * outcome is a denial teaches an operator to ignore denials.
 *
 * Every gate here is an affordance. The backend decides again, against the
 * actual record, on every single request.
 *
 * ## The record is read on the server, the panels read for themselves
 *
 * The route page reads the delivery record after it has decided the operator may
 * see one, so this screen starts loaded rather than blank. Each panel then reads
 * its own subresource, which is what lets one refusal or one outage stay inside
 * one panel instead of taking the screen with it.
 *
 * ## One eligibility read, and one revision counter
 *
 * Eligibility is read HERE rather than inside the panel that displays it,
 * because the completion control needs the same answer and above all the same
 * `recordVersion` — the number a version-guarded completion must quote. Two
 * reads could hand the two panels different versions, so the number on screen
 * and the number in the request would not be the same fact.
 *
 * `revision` counts successful writes and is passed to every panel. Each panel
 * folds it into the key of what it holds, so a write makes every stale answer
 * ABSENT rather than merely old — the panels show their loading state while the
 * fresh reads land, instead of showing a decision that has since changed. Every
 * preparation step moves the delivery version, so a screen that did not re-read
 * would send a version guaranteed to be refused.
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
  canManage = false,
  canIssueWarranty = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The page's own read. */
  readonly delivery: DeliveryRecord;
  readonly canReadFinance: boolean;
  readonly canComplete: boolean;
  /** Whether the caller holds the write code the preparation acts declare. */
  readonly canManage?: boolean;
  /**
   * Whether the caller holds `wty.warranty.issue`.
   *
   * A fourth capability rather than a fold into `canComplete`, for the same reason
   * the other three are separate: issuing a warranty is the code `wty.warranty-generate`
   * declares, and releasing a vehicle is not. Resolving each control against the code
   * ITS OWN operation declares is what stops a screen offering a button whose only
   * outcome is a denial.
   */
  readonly canIssueWarranty?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((previous) => previous + 1), []);
  const eligibility = useEligibility(delivery.id, canReadFinance, revision);

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
        state={eligibility.state}
        withheld={eligibility.withheld}
        canComplete={canComplete}
      />

      <ReceiverPanel
        locale={locale}
        messages={messages}
        deliveryId={delivery.id}
        canManage={canManage}
        revision={revision}
        onDone={refresh}
      />

      <SignaturesPanel
        locale={locale}
        messages={messages}
        deliveryId={delivery.id}
        receptionVisitId={delivery.receptionVisitId}
        canManage={canManage}
        revision={revision}
        onDone={refresh}
      />

      <ChecklistResultsPanel
        messages={messages}
        deliveryId={delivery.id}
        canManage={canManage}
        revision={revision}
        onDone={refresh}
      />

      {/*
        The release control is drawn only for a caller who holds the authority
        the completion declares. Without it there is nothing here to show: the
        eligibility panel above already states whether the vehicle may go, and
        a disabled release button would only invite a click that cannot work.
      */}
      {canComplete ? (
        <CompletionPanel
          messages={messages}
          deliveryId={delivery.id}
          state={eligibility.state}
          withheld={eligibility.withheld}
          onDone={refresh}
        />
      ) : null}

      {/*
        The warranty control is drawn only for a caller holding the code the
        generation declares. It is placed after the release because that is the
        order of the acts: a warranty is dated from the handover, and the database
        refuses to issue one against a handover that has not completed.
      */}
      {canIssueWarranty ? (
        <GenerateWarrantyPanel
          locale={locale}
          messages={messages}
          deliveryId={delivery.id}
          deliveryStatus={delivery.status}
        />
      ) : null}

      <StatusHistoryPanel
        locale={locale}
        messages={messages}
        deliveryId={delivery.id}
        revision={revision}
      />
    </div>
  );
}
