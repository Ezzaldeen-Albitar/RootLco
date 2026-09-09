'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readWorkOrderDelivery } from '../api';
import type { WorkOrderDelivery } from '../delivery-contract';
import { StatusLabel } from './CodeLabel';

/**
 * The way in from a work order to its handover (P1-31, entry point for FE-002).
 *
 * ## It is not rendered at all without the authority to read it
 *
 * The work-order page resolves `sal.delivery.view` and passes the answer down.
 * Without it this component is never mounted, so no request is issued for a
 * delivery the caller may not see — the same gate-before-read discipline the
 * route page follows, one level in. The work-order screen loses a section and
 * nothing else; an operator who may not see handovers has no use for one.
 *
 * ## "No delivery" includes a delivery in exception, and that is the operation's word
 *
 * The read answers with nothing when a work order has no LIVE delivery, and a
 * delivery marked as an exception is reported that way too. This panel states
 * what the operation states and does not narrate a distinction the read does not
 * publish.
 *
 * ## No control creates one
 *
 * Starting a handover is a write with its own authority and its own screen. Until
 * that exists, this panel says there is no delivery and offers no button that
 * would do nothing.
 */
export function WorkOrderDeliveryPanel({
  locale,
  messages,
  workOrderId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
}) {
  const [held, setHeld] = useState<{
    readonly id: string;
    readonly read: ReadState<WorkOrderDelivery>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderDelivery(workOrderId).then((read) => {
      if (!cancelled) setHeld({ id: workOrderId, read });
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  // What was read for ANOTHER work order is absent, not stale-but-shown.
  const state = held !== null && held.id === workOrderId ? held.read : null;

  return (
    <section
      aria-labelledby="work-order-delivery-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-delivery-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'delivery.workOrder.heading')}
      </h2>
      {state === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : state.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${state.status}.title`)}
          {state.correlationId
            ? ` ${translate(messages, 'action.reference')} ${state.correlationId}`
            : ''}
        </p>
      ) : state.data.delivery === null ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'delivery.workOrder.none')}
        </p>
      ) : (
        <p className="text-body text-text-primary">
          <StatusLabel messages={messages} status={state.data.delivery.status} />{' '}
          <Link
            href={`/${locale}/delivery/${state.data.delivery.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'delivery.workOrder.open')}
          </Link>
        </p>
      )}
    </section>
  );
}
