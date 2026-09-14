'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { GenerateWarrantyPanel } from '@/features/warranty/components/GenerateWarrantyPanel';
import { odometerDisplay, type OdometerReadingEntry } from '@/features/vehicles/history-contract';
import type { DeliveryRecord } from '../delivery-contract';
import { ChecklistResultsPanel } from './ChecklistResultsPanel';
import { StatusLabel } from './CodeLabel';
import { CompletionPanel } from './CompletionPanel';
import { DeliveryDocumentPanel } from './DeliveryDocumentPanel';
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
 *
 * ## The final odometer is the ONE reference that is resolved, and not here
 *
 * `sal.delivery-read` publishes `finalOdometerReadingId` and no value, so the
 * reading an operator entered at handover was on the record as an identifier and
 * nowhere as a number — the one fact FE-005 is about, unreadable on the screen
 * that owns it. The value is resolved by the ROUTE, from the vehicle's own
 * odometer history (`veh.vehicle-odometer-history`), and handed down: the page is
 * where the permission for that read is decided, and a client-side read here
 * would ask for it before knowing whether the caller may.
 *
 * It arrives as `null` for three different reasons — the caller does not hold the
 * vehicle read code, the read failed, or the reading is not on the page that was
 * asked for — and all three render the REFERENCE, which is what the record
 * carries. A screen that showed nothing at all in those cases would be hiding the
 * only thing it does know.
 */
export function DeliveryDetailScreen({
  locale,
  messages,
  delivery,
  canReadFinance,
  canComplete,
  canManage = false,
  canIssueWarranty = false,
  canReadWarrantyPolicies = false,
  canReadWorkOrder = false,
  finalOdometerReading = null,
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
  /**
   * Whether the caller holds `wty.warranty.read`, which is what the warranty PLAN
   * picker needs.
   *
   * A fifth capability for the reason the fourth is separate: the authority to issue a
   * warranty and the authority to read one are two codes, and a caller may hold either
   * without the other. Passing it down means the plans are asked for only when the
   * answer can be anything but a refusal.
   */
  readonly canReadWarrantyPolicies?: boolean;
  /**
   * Whether the caller holds the code the work-order read declares.
   *
   * A sixth capability, consulted by the printable sheet alone. It is the only
   * read reachable from this screen that resolves a customer name, a
   * registration plate or a work-order number, and a caller without the code is
   * not asked to spend a request discovering that.
   */
  readonly canReadWorkOrder?: boolean;
  /**
   * The reading `finalOdometerReadingId` points at, resolved by the route.
   *
   * `null` or absent means it could not be resolved, and the reference is shown
   * instead. Never resolved here: see the note above.
   */
  readonly finalOdometerReading?: OdometerReadingEntry | null;
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
          {/*
            The NAME the server stamped when the handover was opened, not a
            lookup this screen performed: the snapshot is what keeps a completed
            handover readable after a later rename or transfer. A handover
            recorded before the employee register existed may carry no name at
            all, and that one shows the reference it does carry rather than a
            person invented to fill the gap.
          */}
          {delivery.deliveringEmployeeDisplayName === null ? (
            <Reference
              label={translate(messages, 'delivery.summary.deliveringEmployee')}
              value={delivery.deliveringEmployeeId}
            />
          ) : (
            <Fact label={translate(messages, 'delivery.summary.deliveringEmployee')}>
              {delivery.deliveringEmployeeDisplayName}
            </Fact>
          )}
          {/*
            The value when the route resolved it, the reference when it did not,
            and the LABEL says which of the two is on screen — "reference" is part
            of the reference label and would be a lie above a reading.

            `odometerDisplay` composes it, so the reading is presented here
            exactly as the vehicle's own history presents it: the stored decimal
            string and its unit, never converted and never parsed into a number.
          */}
          {finalOdometerReading === null ? (
            <Reference
              label={translate(messages, 'delivery.summary.finalOdometerReading')}
              value={delivery.finalOdometerReadingId}
            />
          ) : (
            <Fact label={translate(messages, 'delivery.summary.finalOdometer')}>
              <span dir="ltr">{odometerDisplay(finalOdometerReading).primary}</span>
            </Fact>
          )}
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
          deliveryCompanyId={delivery.companyId}
          deliveryStatus={delivery.status}
          canReadPolicies={canReadWarrantyPolicies}
        />
      ) : null}

      <StatusHistoryPanel
        locale={locale}
        messages={messages}
        deliveryId={delivery.id}
        revision={revision}
      />

      {/*
        The printable sheet (FE-007). It is drawn for every caller this screen
        renders for — the route already required the delivery code to get here —
        and it composes itself from the reads that caller holds: the release
        checks are reused from above rather than read again, and the work order
        is read only by a caller who holds the code that read declares.
      */}
      <DeliveryDocumentPanel
        locale={locale}
        messages={messages}
        delivery={delivery}
        eligibility={eligibility}
        canReadWorkOrder={canReadWorkOrder}
        finalOdometerReading={finalOdometerReading}
        revision={revision}
      />
    </div>
  );
}
