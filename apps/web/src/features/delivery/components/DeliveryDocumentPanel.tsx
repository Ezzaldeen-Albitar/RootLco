'use client';

import { useEffect, useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderDetail } from '@/features/work-orders/work-orders-contract';

import { listChecklistResults, listSignatures, listStatusHistory, readReceiver } from '../api';
import type {
  DeliveryChecklistResultsEnvelope,
  DeliveryPage,
  DeliveryRecord,
  DeliveryReceiverEnvelope,
  DeliverySignaturesEnvelope,
  DeliveryStatusHistoryEnvelope,
} from '../delivery-contract';
import {
  DeliveryDocument,
  type DocumentFact,
  type DocumentRead,
  type DocumentSection,
} from './DeliveryDocument';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './PanelShell';
import type { HeldEligibility } from './use-eligibility';

/**
 * The control that produces the printable handover sheet (P1-31, FE-007).
 *
 * ## It reads nothing until it is asked to
 *
 * The sheet needs four subresources the screen's panels already show, and
 * reading them a second time on every visit to a handover would double the cost
 * of the screen for a document most visits never print. So the reads happen when
 * the sheet is opened, on the invoice screen's precedent, and the print control
 * appears only once they have landed — a button that prints a half-composed
 * sheet is worse than one that is not there yet.
 *
 * ## The sheet is composed from what THIS caller may read, and says so
 *
 * Nothing here decides authority. The route already refused anyone without the
 * delivery code, so this panel is drawn only inside a screen that code
 * unlocked. Two reads declare MORE than that code, and both are decided before
 * they are asked:
 *
 *   - the release checks demand the financial read code as well, so the screen's
 *     own held answer is reused — one read, one version, one story on screen and
 *     on paper — and a caller without the code gets a sheet that states the
 *     checks were left off rather than one that quietly omits them;
 *   - the work-order read declares its own code, and it is the only read
 *     reachable from here that publishes a customer name, a registration plate
 *     or a work-order number. Without that code it is not asked, and the sheet
 *     prints the identifiers the delivery record carries.
 *
 * Both are affordances. The backend decides again on every request.
 *
 * ## Nothing is written, and nothing is stored
 *
 * No write adapter is imported here, no operation was added for this sheet, and
 * no document version is created: the Owner's D-7 answer deferred stored
 * immutable versions to their own contract, and a print view may not become one
 * by accident. `window.print()` is the browser's own dialogue and produces no
 * bytes this application can see.
 *
 * ## A write elsewhere on the screen invalidates what was read
 *
 * `revision` is the screen's count of successful writes and is part of the key
 * of what is held, exactly as it is for every other panel. A sheet composed
 * before a checklist result was recorded is treated as ABSENT once it lands,
 * rather than left on screen as a printable copy of a handover that has moved
 * on.
 */

/** Everything one composition of the sheet needs, and the key it was read under. */
interface Composed {
  readonly key: string;
  readonly receiver: ReadState<DeliveryReceiverEnvelope>;
  readonly checklist: ReadState<DeliveryChecklistResultsEnvelope>;
  readonly signatures: ReadState<DeliverySignaturesEnvelope>;
  readonly history: ReadState<DeliveryStatusHistoryEnvelope>;
  /** `null` when the caller does not hold the work-order read's own code. */
  readonly workOrder: ReadState<WorkOrderDetail> | null;
}

const keyOf = (deliveryId: string, revision: number) => `${deliveryId}#${String(revision)}`;

export function DeliveryDocumentPanel({
  locale,
  messages,
  delivery,
  eligibility,
  canReadWorkOrder,
  revision = 0,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly delivery: DeliveryRecord;
  /** The screen's one eligibility answer, reused rather than read again. */
  readonly eligibility: HeldEligibility;
  /** Whether the caller holds the code the work-order read declares. */
  readonly canReadWorkOrder: boolean;
  readonly revision?: number;
}) {
  const [open, setOpen] = useState(false);
  const [composed, setComposed] = useState<Composed | null>(null);
  const key = keyOf(delivery.id, revision);
  const held = composed !== null && composed.key === key ? composed : null;

  useEffect(() => {
    if (!open || held !== null) return undefined;
    let live = true;
    void Promise.all([
      readReceiver(delivery.id),
      listChecklistResults(delivery.id, null),
      listSignatures(delivery.id, null),
      listStatusHistory(delivery.id, null),
      canReadWorkOrder ? readWorkOrderDetail(delivery.workOrderId) : Promise.resolve(null),
    ]).then(([receiver, checklist, signatures, history, workOrder]) => {
      if (live) setComposed({ key, receiver, checklist, signatures, history, workOrder });
    });
    return () => {
      live = false;
    };
  }, [open, held, key, delivery.id, delivery.workOrderId, canReadWorkOrder]);

  // The release checks are part of the sheet, so a sheet may not be printed
  // while the screen's own answer is still in flight: it would print "could not
  // be read" over a read that had not finished.
  const checksSettled = eligibility.withheld || eligibility.state !== null;
  const ready = held !== null && checksSettled;

  return (
    <section
      aria-labelledby="delivery-document-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <h2 id="delivery-document-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'delivery.document.heading')}
        </h2>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-expanded={open}
          onClick={() => setOpen((previous) => !previous)}
        >
          {translate(messages, open ? 'delivery.document.close' : 'delivery.document.open')}
        </button>
        {open && ready ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => window.print()}>
            {translate(messages, 'delivery.document.print')}
          </button>
        ) : null}
      </div>
      <p className="text-caption text-text-muted" data-print="hide">
        {translate(messages, 'delivery.document.explain')}
      </p>
      {!open ? null : !ready ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : (
        <DeliveryDocument
          locale={locale}
          messages={messages}
          delivery={delivery}
          workOrder={workOrderFact(held.workOrder)}
          eligibility={
            eligibility.withheld
              ? { kind: 'withheld' }
              : factFrom(eligibility.state, (value) => value)
          }
          receiver={factFrom(held.receiver, (envelope) => envelope.receiver)}
          checklist={sectionFrom(held.checklist, (envelope) => envelope.results)}
          signatures={sectionFrom(held.signatures, (envelope) => envelope.signatures)}
          history={sectionFrom(held.history, (envelope) => envelope.transitions)}
        />
      )}
    </section>
  );
}

/**
 * A read the screen may not have been allowed to make.
 *
 * `null` means the code was absent and nothing was asked, which is a different
 * sentence from a refusal and is printed as one.
 */
function workOrderFact(state: ReadState<WorkOrderDetail> | null): DocumentFact<WorkOrderDetail> {
  if (state === null) return { kind: 'withheld' };
  return factFrom(state, (value) => value);
}

/**
 * One read outcome, turned into what the sheet prints.
 *
 * The correlation reference travels with a refusal because it is the only
 * diagnostic anyone chasing the gap will have. A successful read's own value is
 * selected here rather than in the document, so the sheet never learns the shape
 * of an envelope.
 */
function factFrom<E, T>(state: ReadState<E> | null, select: (envelope: E) => T): DocumentRead<T> {
  if (state === null) return { kind: 'refused', reference: null };
  if (state.status !== 'ok') return { kind: 'refused', reference: state.correlationId };
  return { kind: 'read', value: select(state.data) };
}

/** One paged read outcome, with the server's own end-of-set signal carried through. */
function sectionFrom<E, T>(
  state: ReadState<E>,
  select: (envelope: E) => DeliveryPage<T>
): DocumentSection<T> {
  if (state.status !== 'ok') return { kind: 'refused', reference: state.correlationId };
  const page = select(state.data);
  return { kind: 'read', rows: page.items, hasMore: page.hasMore };
}
