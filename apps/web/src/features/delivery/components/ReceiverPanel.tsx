'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/states/States';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readReceiver } from '../api';
import type { DeliveryReceiverEnvelope } from '../delivery-contract';
import { Fact, Panel, PanelFailure, PanelLoading, Reference } from './PanelShell';

/**
 * Who is authorised to take this vehicle away, and who confirmed it (FE-003).
 *
 * ## No receiver yet is a normal state, not a failure
 *
 * The read answers a delivery with no verified receiver with a 200 and nothing
 * inside it. That is the ordinary condition of a fresh delivery, so it is drawn
 * as an empty state with a sentence saying what has not happened yet — never as
 * an error, and never as a blank area that leaves the operator guessing whether
 * the screen finished loading.
 *
 * ## The identity evidence is named and never fetched
 *
 * The row carries a reference to a stored identity document. This panel states
 * that the evidence is on file and stops there: no request is made for the
 * document, no reference to it is printed, and nothing on this screen offers a
 * way to open it. An identity document is the most sensitive thing this custody
 * chain touches, and a delivery screen has no business displaying one.
 *
 * ## The people are identifiers
 *
 * The receiver is a partner identifier and the confirming employee is a bare
 * identifier. Nothing in the platform resolves either to a name, so both are
 * rendered as labelled references rather than dressed up as people.
 */
export function ReceiverPanel({
  locale,
  messages,
  deliveryId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
}) {
  const [held, setHeld] = useState<{
    readonly id: string;
    readonly read: ReadState<DeliveryReceiverEnvelope>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readReceiver(deliveryId).then((read) => {
      if (!cancelled) setHeld({ id: deliveryId, read });
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId]);

  // What was read for ANOTHER delivery is absent, not stale-but-shown. Clearing
  // state as the effect starts would do the same job with a window in which one
  // delivery's receiver sat under another delivery's heading.
  const state = held !== null && held.id === deliveryId ? held.read : null;

  return (
    <Panel
      headingId="delivery-receiver-heading"
      titleKey="delivery.receiver.heading"
      messages={messages}
    >
      {state === null ? (
        <PanelLoading messages={messages} />
      ) : state.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={state.status}
          correlationId={state.correlationId}
        />
      ) : state.data.receiver === null ? (
        <EmptyState
          messages={messages}
          titleKey="delivery.receiver.noneTitle"
          descriptionKey="delivery.receiver.noneDescription"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Reference
            label={translate(messages, 'delivery.receiver.partner')}
            value={state.data.receiver.receiverPartnerId}
          />
          <Reference
            label={translate(messages, 'delivery.receiver.verifiedBy')}
            value={state.data.receiver.verifiedBy}
          />
          <Fact label={translate(messages, 'delivery.receiver.verifiedAt')}>
            {formatDateTime(state.data.receiver.verifiedAt, locale)}
          </Fact>
          <p className="text-caption text-text-secondary">
            {translate(
              messages,
              state.data.receiver.identityEvidenceDocumentVersionId === null
                ? 'delivery.receiver.evidenceAbsent'
                : 'delivery.receiver.evidenceOnFile'
            )}
          </p>
        </div>
      )}
    </Panel>
  );
}
