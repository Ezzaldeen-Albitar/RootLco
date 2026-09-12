'use client';

import { useEffect, useState, useTransition } from 'react';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { EmptyState } from '@/components/states/States';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readReceiver, verifyReceiver } from '../api';
import type { DeliveryReceiverEnvelope } from '../delivery-contract';
import { Fact, PRIMARY_BUTTON, Panel, PanelFailure, PanelLoading, Reference } from './PanelShell';

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
 *
 * ## The caller nominates; the platform decides
 *
 * The verification form asserts no authority and pre-filters no list.
 * `sal.guard_authorized_receiver` requires the nominated partner to hold a
 * reception party role for this delivery's visit that is valid at the moment of
 * verification, so a role that has expired does not authorise a collection
 * today. A refusal is the platform answering, and is rendered as such.
 *
 * ## Identity evidence is NOT captured here, and that is a recorded gap
 *
 * The operation accepts an optional identity-evidence document version and this
 * form produces none. Capturing a document needs a document CATEGORY that admits
 * it; `shared.document_categories` seeds seven, every one a reception category,
 * and the only one whose purpose is an identity document is the VIN evidence
 * category. Filing a person's proof of identity under vehicle-identification
 * evidence would be a classification defect wearing the shape of a feature, and
 * minting a category is a seed this lane does not own. So the field is omitted
 * rather than mis-filed, and the missing category is recorded as a named
 * prerequisite instead of being worked around.
 */
export function ReceiverPanel({
  locale,
  messages,
  deliveryId,
  canManage = false,
  revision = 0,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  /** Whether the caller holds the write code the verification declares. */
  readonly canManage?: boolean;
  /** The screen's count of successful writes; a change re-reads this panel. */
  readonly revision?: number;
  /** Called after a successful verification so the screen re-reads every panel. */
  readonly onDone?: (() => void) | undefined;
}) {
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: ReadState<DeliveryReceiverEnvelope>;
  } | null>(null);
  const key = `${deliveryId}#${String(revision)}`;

  useEffect(() => {
    let cancelled = false;
    void readReceiver(deliveryId).then((read) => {
      if (!cancelled) setHeld({ key, read });
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId, key]);

  // What was read for ANOTHER delivery, or before the last write, is absent
  // rather than stale-but-shown. Clearing state as the effect starts would do
  // the same job with a window in which one delivery's receiver sat under
  // another delivery's heading.
  const state = held !== null && held.key === key ? held.read : null;

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
        <div className="flex flex-col gap-4">
          <EmptyState
            messages={messages}
            titleKey="delivery.receiver.noneTitle"
            descriptionKey="delivery.receiver.noneDescription"
          />
          {canManage ? (
            <VerifyForm
              locale={locale}
              messages={messages}
              deliveryId={deliveryId}
              onDone={onDone}
            />
          ) : null}
        </div>
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

/**
 * Nominate the partner who may collect the vehicle.
 *
 * Offered only while nobody is confirmed. `uq_authorized_receivers_delivery`
 * permits exactly one receiver per delivery, so a form drawn beside a confirmed
 * receiver would be a control whose only possible outcome is a refusal.
 *
 * The partner is chosen by NAME through the shared selector. The contract wants
 * an identifier and an operator must never be asked to know one, so the selector
 * carries the identifier and shows a person.
 */
function VerifyForm({
  locale,
  messages,
  deliveryId,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  readonly onDone?: (() => void) | undefined;
}) {
  const [partner, setPartner] = useState<SelectedCustomer | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (partner === null) {
      setMissing(true);
      return;
    }
    setMissing(false);
    startTransition(() => {
      void verifyReceiver(deliveryId, { receiverPartnerId: partner.id }).then((result) => {
        notifyActionResult(result, messages);
        if (result.status === 'success') {
          setPartner(null);
          onDone?.();
        }
      });
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-label font-medium text-text-primary">
        {translate(messages, 'delivery.receiver.verifyHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'delivery.receiver.verifyExplain')}
      </p>
      <CustomerSelector
        locale={locale}
        messages={messages}
        name="receiverPartnerId"
        labelKey="delivery.receiver.partnerLabel"
        value={partner}
        onChange={setPartner}
        required
      />
      {missing ? (
        <p role="alert" className="text-body text-error">
          {translate(messages, 'delivery.receiver.partnerRequired')}
        </p>
      ) : null}
      <div>
        <button type="button" className={PRIMARY_BUTTON} disabled={pending} onClick={submit}>
          {translate(messages, 'delivery.receiver.verifySubmit')}
        </button>
      </div>
    </div>
  );
}
