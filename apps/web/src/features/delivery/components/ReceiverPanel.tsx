'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { EmptyState, FailureExplanation } from '@/components/states/States';
import { listDocumentCategories } from '@/features/attachments/api';
import type { DocumentCategory } from '@/features/attachments/attachments-contract';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { formatDateTime, intlLocale } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readReceiver } from '../api';
import {
  RECEIVER_IDENTITY_CATEGORY_CODE,
  type DeliveryReceiverEnvelope,
} from '../delivery-contract';
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
 * is stated on the panel, the receiver stays unverified, and the document stays
 * chosen: a further Confirm sends it again, and verifying without it takes the
 * operator's explicit Remove. A successful write on another panel re-reads this
 * one without unmounting the form, so that write does not drop the document
 * either. One path is the browser's own: reopening the native picker and
 * cancelling it empties the control in Chromium, and nothing on the panel can
 * keep a file the browser itself let go. That path is not silent: the panel's
 * own status line, announced to assistive technology, changes from the
 * document-chosen sentence to one saying no document is chosen and the receiver
 * will be confirmed without one, and the Remove control leaves with the choice,
 * all before Confirm is pressed. No other category is ever used in its place. The
 * file control's accepted types and the stated size ceiling are read from the
 * identity category's published row; nothing on the panel filters a file, so a
 * file the row does not admit is refused by the server's upload authorization.
 * A caller without the document codes may still verify, and is told why no file
 * control is offered.
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
    readonly deliveryId: string;
    readonly read: ReadState<DeliveryReceiverEnvelope>;
    /** The last answer that succeeded for `deliveryId`, kept across a failed re-read. */
    readonly lastOk: DeliveryReceiverEnvelope | null;
  } | null>(null);
  const key = `${deliveryId}#${String(revision)}`;

  useEffect(() => {
    let cancelled = false;
    void readReceiver(deliveryId).then((read) => {
      if (cancelled) return;
      setHeld((previous) => ({
        key,
        deliveryId,
        read,
        lastOk:
          read.status === 'ok'
            ? read.data
            : previous !== null && previous.deliveryId === deliveryId
              ? previous.lastOk
              : null,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId, key]);

  // What was read for ANOTHER delivery is absent rather than stale-but-shown.
  // Clearing state as the effect starts would do the same job with a window in
  // which one delivery's receiver sat under another delivery's heading.
  //
  // A re-read of the SAME delivery after another panel's write is different,
  // and deliberately so. Swapping the panel for its loading state would unmount
  // the verification form, and with it the document the operator chose, the
  // partner and the refusal that said the document is still chosen: the next
  // Confirm would then verify WITHOUT the document and without any Remove. So
  // the last successful answer for this delivery stays drawn while the re-read
  // lands, and a failed re-read is stated above it rather than in its place.
  // Nothing another panel writes changes who received the vehicle, and a
  // verification the form sends is decided by the server, not by this read.
  const current = held !== null && held.key === key ? held.read : null;
  const known = held !== null && held.deliveryId === deliveryId ? held.lastOk : null;
  const failure = current !== null && current.status !== 'ok' ? current : null;

  return (
    <Panel
      headingId="delivery-receiver-heading"
      titleKey="delivery.receiver.heading"
      messages={messages}
    >
      {failure === null ? null : (
        <PanelFailure
          messages={messages}
          status={failure.status}
          correlationId={failure.correlationId}
        />
      )}
      {known === null ? (
        failure === null ? (
          <PanelLoading messages={messages} />
        ) : null
      ) : known.receiver === null ? (
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
            value={known.receiver.receiverPartnerId}
          />
          <Reference
            label={translate(messages, 'delivery.receiver.verifiedBy')}
            value={known.receiver.verifiedBy}
          />
          <Fact label={translate(messages, 'delivery.receiver.verifiedAt')}>
            {formatDateTime(known.receiver.verifiedAt, locale)}
          </Fact>
          <p className="text-caption text-text-secondary">
            {translate(
              messages,
              known.receiver.identityEvidenceDocumentVersionId === null
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
  /**
   * The numbers the refusal published about itself, for the `{name}` places in
   * that sentence. A throttled verification advises a wait in here, and a
   * sentence rendered without it prints the placeholder rather than the wait.
   * `formatMessage` substitutes only the places a sentence actually has, so a
   * step that answers with its own wording is unaffected by carrying them.
   */
  readonly messageValues: Readonly<Record<string, string>> | undefined;
  /** The reason a named control carried, when one did. */
  readonly fieldKey: string | null;
  /** The reference the backend logged. */
  readonly correlationId: string | null;
  /** Whether a document was part of the attempt, so the operator is told it is still chosen. */
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

/** Bytes in the unit the ceiling is stated in. A unit conversion, not a limit. */
const BYTES_PER_MEGABYTE = 1_048_576;

/**
 * What the identity category's published row admits, as the panel read it.
 *
 * `loading` until the read settles; `unavailable` when the list could not be
 * read or carries no identity row. Neither of those two blocks anything: the
 * capture reads the row again when the operator confirms, and that read is the
 * one that decides.
 */
type EvidencePolicy =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly category: DocumentCategory };

/** The row's content types, named the way an operator names a file: `JPEG`, not `image/jpeg`. */
function plainTypeNames(types: readonly string[], locale: Locale): string {
  const names = types.map((type) => type.slice(type.indexOf('/') + 1).toUpperCase());
  return new Intl.ListFormat(intlLocale(locale), { style: 'long', type: 'conjunction' }).format(
    names
  );
}

/** The row's size ceiling in megabytes, in the reader's own number format. */
function sizeCeiling(bytes: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / BYTES_PER_MEGABYTE);
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
 * ## A chosen document stays chosen until the operator removes it
 *
 * A file has to reach a Server Action, and `FormData` is what that boundary
 * carries. It is taken from the form in the submit handler rather than through
 * `<form action={...}>`, because React resets a form once such an action
 * settles, and that reset empties the file control. After a failed capture, a
 * failed link or a refusal, the document the operator chose would silently
 * leave the form, and the next Confirm would verify WITHOUT it — the one thing
 * the Owner's requirement forbids. Here nothing is reset on failure: the
 * document stays chosen, a further Confirm sends it again, and verifying
 * without it takes the explicit Remove. Only a success clears the form.
 *
 * The submit control checks the partner first and only then asks the form to
 * submit, so a missing partner costs no request and does not clear a document
 * the operator already chose.
 *
 * ## The accepted types and the ceiling are the category row's
 *
 * The file control's `accept` list and the sentence beside it come from the
 * identity category the server publishes, read when the form opens. Nothing here
 * filters a file by type or size: `accept` is a hint to the browser's picker, and
 * the upload authorization is what refuses a file the row does not admit.
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
  const [policy, setPolicy] = useState<EvidencePolicy>({ status: 'loading' });
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const refocusFile = useRef(false);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const fileId = `${baseId}-evidence`;
  const hintId = `${baseId}-evidence-hint`;
  const limitsId = `${baseId}-evidence-limits`;

  useEffect(() => {
    if (!refocusFile.current) return;
    refocusFile.current = false;
    document.getElementById(fileId)?.focus();
  }, [fileKey, fileId]);

  useEffect(() => {
    if (!canAttachEvidence) return;
    let cancelled = false;
    void listDocumentCategories().then((read) => {
      if (cancelled) return;
      const category =
        read.status === 'ok'
          ? read.data.items.find((entry) => entry.categoryCode === RECEIVER_IDENTITY_CATEGORY_CODE)
          : undefined;
      setPolicy(category === undefined ? { status: 'unavailable' } : { status: 'ready', category });
    });
    return () => {
      cancelled = true;
    };
  }, [canAttachEvidence]);

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
    setRefusal(null);
    setFileKey((previous) => previous + 1);
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (partner === null) {
      setMissing(true);
      return;
    }
    const partnerId = partner.id;
    // Taken before the transition starts: the controls are disabled while it
    // runs, and a disabled control contributes nothing to a form's data.
    const formData = new FormData(event.currentTarget);
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
      if (result.status === 'success') {
        setPartner(null);
        setChosen(false);
        setFileKey((previous) => previous + 1);
        onDone?.();
        return;
      }
      setRefusal({
        messageKey: refusalKey(result),
        messageValues: result.messageValues,
        fieldKey: firstFieldError(result.fieldErrors),
        correlationId: result.correlationId ?? null,
        withEvidence: result.withEvidence,
      });
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
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
            describedBy={`${hintId} ${limitsId}`}
            disabled={pending}
            accept={policy.status === 'ready' ? policy.category.allowedContentTypes : undefined}
            onChosenChange={setChosen}
          />
          <p id={hintId} className="text-caption text-text-muted">
            {translate(messages, 'delivery.receiver.evidenceHint')}
          </p>
          <p id={limitsId} className="text-caption text-text-muted">
            {policy.status === 'loading'
              ? translate(messages, 'delivery.receiver.evidenceLimitsLoading')
              : policy.status === 'unavailable'
                ? translate(messages, 'delivery.receiver.evidenceLimitsUnavailable')
                : `${translate(messages, 'delivery.receiver.evidenceTypes')} ${plainTypeNames(
                    policy.category.allowedContentTypes,
                    locale
                  )}. ${translate(messages, 'delivery.receiver.evidenceMaxSize')} ${sizeCeiling(
                    policy.category.maxBytes,
                    locale
                  )}.`}
          </p>
          {/*
           * Always drawn, and a live region: whether a document is chosen is
           * stated in words, so a control the browser emptied (a cancelled
           * picker) is announced as no document before Confirm, not discovered
           * after it.
           */}
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="text-caption text-text-secondary">
              {translate(
                messages,
                chosen ? 'delivery.receiver.evidenceChosen' : 'delivery.receiver.evidenceNoneChosen'
              )}
            </p>
            {chosen ? (
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={pending}
                onClick={removeFile}
              >
                {translate(messages, 'delivery.receiver.evidenceRemove')}
              </button>
            ) : null}
          </div>
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
            {translateWithValues(messages, refusal.messageKey, refusal.messageValues)}
            <FailureExplanation messages={messages} messageKey={refusal.messageKey} />
          </p>
          {refusal.withEvidence && chosen ? (
            <p className="text-caption text-text-secondary">
              {translate(messages, 'delivery.receiver.evidenceStillChosen')}
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
