'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { EmptyState } from '@/components/states/States';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readReceiver } from '../api';
import type { DeliveryReceiverEnvelope } from '../delivery-contract';
import { verifyReceiverWithEvidence, type ReceiverVerificationOutcome } from '../receiver-capture';
import {
  Fact,
  PRIMARY_BUTTON,
  Panel,
  PanelFailure,
  PanelLoading,
  Reference,
  SECONDARY_BUTTON,
} from './PanelShell';

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
 * ## Identity evidence is OPTIONAL, and captured when chosen (D-18)
 *
 * The form offers one optional document under the approved
 * `delivery_receiver_identity` category, through `verifyReceiverWithEvidence`,
 * which follows the signature capture's order: read the categories, capture the
 * document against this delivery's own reception visit, link it under the
 * category's own purpose, then verify with the version bound. Without a chosen
 * file the verification is sent exactly as before, so nothing here requires the
 * evidence. With one, a failed capture, a failed link or a refused verification
 * is stated on the panel, the receiver stays unverified, and the verification is
 * never sent again without the document. No other category is ever used in its
 * place. A caller without the document codes may still verify, and is told why
 * no file control is offered.
 */
export function ReceiverPanel({
  locale,
  messages,
  deliveryId,
  receptionVisitId,
  canManage = false,
  canAttachEvidence = false,
  revision = 0,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  /** The visit this handover closes; identity evidence is captured against it. */
  readonly receptionVisitId: string;
  /** Whether the caller holds the write code the verification declares. */
  readonly canManage?: boolean;
  /** Whether the caller holds the two document codes the evidence needs. */
  readonly canAttachEvidence?: boolean;
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
              receptionVisitId={receptionVisitId}
              canAttachEvidence={canAttachEvidence}
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

/** What an unsuccessful verification left to say, in catalogue keys only. */
interface Refusal {
  /** The sentence for the step that stopped the act. Always a KEY. */
  readonly messageKey: string;
  /** The reason a named control carried, when one did. */
  readonly fieldKey: string | null;
  /** The reference the backend logged. */
  readonly correlationId: string | null;
  /** Whether a document was chosen, so the operator is told it must be chosen again. */
  readonly withEvidence: boolean;
}

/**
 * The refusals the delivery service answers a bound document with, in the
 * operator's words. Only consulted when a document was part of the request: the
 * same codes on a verification without one are about something else.
 *
 * Only `ERR-DOC-001` is about the document alone. The service also answers
 * `ERR-RES-001` for a receiver or visit that does not exist in scope and for a
 * delivery the caller cannot see, and `ERR-VAL-001` for other refused details,
 * so those two sentences name the document as one possible cause, never as the
 * only one.
 */
const EVIDENCE_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  'ERR-VAL-001': 'delivery.receiver.evidenceRefusedInvalid',
  'ERR-DOC-001': 'delivery.receiver.evidenceRefusedReview',
  'ERR-RES-001': 'delivery.receiver.evidenceRefusedMissing',
};

function refusalKey(result: ReceiverVerificationOutcome): string {
  if (result.withEvidence) {
    if (result.stage === 'upload') return 'delivery.receiver.evidenceUploadFailed';
    if (result.stage === 'link') return 'delivery.receiver.evidenceLinkFailed';
    if (result.stage === 'verify' && result.code !== undefined) {
      const known = EVIDENCE_REFUSAL_KEYS[result.code];
      if (known !== undefined) return known;
    }
  }
  return result.messageKey ?? 'form.formError';
}

function firstFieldError(fieldErrors: Readonly<Record<string, string>> | undefined): string | null {
  if (fieldErrors === undefined) return null;
  const [first] = Object.values(fieldErrors);
  return first ?? null;
}

/**
 * Nominate the partner who may collect the vehicle, with an optional document.
 *
 * Offered only while nobody is confirmed. `uq_authorized_receivers_delivery`
 * permits exactly one receiver per delivery, so a form drawn beside a confirmed
 * receiver would be a control whose only possible outcome is a refusal.
 *
 * The partner is chosen by NAME through the shared selector. The contract wants
 * an identifier and an operator must never be asked to know one, so the selector
 * carries the identifier and shows a person.
 *
 * A native `<form action={...}>`, because a chosen file has to reach a Server
 * Action and `FormData` is what that boundary carries. The submit control checks
 * the partner first and only then asks the form to submit, so a missing partner
 * costs no request and does not clear a document the operator already chose.
 * React clears the file control once an action settles, which is why a refusal
 * after a chosen document says the document must be chosen again.
 */
function VerifyForm({
  locale,
  messages,
  deliveryId,
  receptionVisitId,
  canAttachEvidence,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  readonly receptionVisitId: string;
  readonly canAttachEvidence: boolean;
  readonly onDone?: (() => void) | undefined;
}) {
  const [partner, setPartner] = useState<SelectedCustomer | null>(null);
  const [missing, setMissing] = useState(false);
  const [chosen, setChosen] = useState(false);
  /* Remounts the file control, which is how a chosen file is removed. */
  const [fileKey, setFileKey] = useState(0);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /*
   * The settlement counter. React resets this form once an action settles, and
   * the selector's own party-type `<select>` is re-synced only by a remount, so
   * the selector is told each settled attempt and remounts to what was chosen.
   */
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const refocusFile = useRef(false);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const fileId = `${baseId}-evidence`;
  const hintId = `${baseId}-evidence-hint`;

  useEffect(() => {
    if (!refocusFile.current) return;
    refocusFile.current = false;
    document.getElementById(fileId)?.focus();
  }, [fileKey, fileId]);

  const submit = () => {
    if (partner === null) {
      setMissing(true);
      return;
    }
    setMissing(false);
    formRef.current?.requestSubmit();
  };

  const removeFile = () => {
    refocusFile.current = true;
    setChosen(false);
    setFileKey((previous) => previous + 1);
  };

  const action = (formData: FormData) => {
    if (partner === null) return;
    const partnerId = partner.id;
    setRefusal(null);
    // An ASYNC transition, so `pending` holds for the whole chain — category,
    // capture, link and verification — rather than for the instant it started.
    startTransition(async () => {
      const result = await verifyReceiverWithEvidence(
        deliveryId,
        receptionVisitId,
        partnerId,
        formData
      );
      notifyActionResult(result, messages);
      setAttempt((previous) => previous + 1);
      setChosen(false);
      setFileKey((previous) => previous + 1);
      if (result.status === 'success') {
        setPartner(null);
        onDone?.();
        return;
      }
      setRefusal({
        messageKey: refusalKey(result),
        fieldKey: firstFieldError(result.fieldErrors),
        correlationId: result.correlationId ?? null,
        withEvidence: result.withEvidence,
      });
    });
  };

  return (
    <form
      ref={formRef}
      action={action}
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-border-subtle pt-4"
    >
      <h3 id={headingId} className="text-label font-medium text-text-primary">
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
        attempt={attempt}
        required
      />
      {missing ? (
        <p role="alert" className="text-body text-error">
          {translate(messages, 'delivery.receiver.partnerRequired')}
        </p>
      ) : null}
      {canAttachEvidence ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={fileId} className="text-label font-medium text-text-primary">
            {translate(messages, 'delivery.receiver.evidenceLabel')}
          </label>
          <CaptureFileField
            key={`identity-evidence-${String(fileKey)}`}
            id={fileId}
            name="identityEvidenceFile"
            label={translate(messages, 'delivery.receiver.evidenceLabel')}
            describedBy={hintId}
            disabled={pending}
            onChosenChange={setChosen}
          />
          <p id={hintId} className="text-caption text-text-muted">
            {translate(messages, 'delivery.receiver.evidenceHint')}
          </p>
          {chosen ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-caption text-text-secondary">
                {translate(messages, 'delivery.receiver.evidenceChosen')}
              </p>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={pending}
                onClick={removeFile}
              >
                {translate(messages, 'delivery.receiver.evidenceRemove')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'delivery.receiver.evidenceNotPermitted')}
        </p>
      )}
      {refusal === null || refusal.fieldKey === null ? null : (
        <p role="alert" className="text-supporting text-error">
          {translateDynamic(messages, refusal.fieldKey)}
        </p>
      )}
      {refusal === null ? null : (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-error-border bg-error-subtle p-3"
        >
          <p className="text-body text-text-primary">
            {translate(messages, 'delivery.receiver.refused')}
          </p>
          <p className="text-caption text-text-secondary">
            {translateDynamic(messages, refusal.messageKey)}
          </p>
          {refusal.withEvidence ? (
            <p className="text-caption text-text-secondary">
              {translate(messages, 'delivery.receiver.evidenceChooseAgain')}
            </p>
          ) : null}
          {refusal.correlationId === null ? null : (
            <p className="text-caption text-text-muted">
              {translate(messages, 'action.reference')}{' '}
              <code className="font-mono text-caption" dir="ltr">
                {refusal.correlationId}
              </code>
            </p>
          )}
        </div>
      )}
      {pending ? (
        <p role="status" className="text-caption text-text-muted">
          {translate(messages, 'delivery.receiver.verifying')}
        </p>
      ) : null}
      <div>
        <button type="button" className={PRIMARY_BUTTON} disabled={pending} onClick={submit}>
          {translate(messages, 'delivery.receiver.verifySubmit')}
        </button>
      </div>
    </form>
  );
}
