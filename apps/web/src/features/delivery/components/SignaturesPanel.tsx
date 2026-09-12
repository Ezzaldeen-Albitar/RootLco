'use client';

import { useState, useTransition } from 'react';
import { SelectField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listSignatures } from '../api';
import { captureDeliverySignature } from '../signature-capture';
import {
  SIGNER_ROLES,
  SIGNER_ROLE_LABEL_KEYS,
  type DeliverySignature,
  type DeliverySignaturesEnvelope,
} from '../delivery-contract';
import { SignerRoleLabel } from './CodeLabel';
import { PRIMARY_BUTTON, Panel, PanelFailure, PanelLoading, SECONDARY_BUTTON } from './PanelShell';
import { usePagedList } from './use-paged-list';

/**
 * The signatures collected against this handover (FE-006), newest first.
 *
 * ## A signature is an event, not a picture
 *
 * Each row carries a reference to a stored signature document and this panel
 * never dereferences it: the sentence is that a signature document is on file,
 * and there is no control here that would fetch the bytes. What the operator
 * needs from this screen is who signed, in what role, and when — all three of
 * which the read publishes directly.
 *
 * ## An empty list is an empty list, and a refusal is a refusal
 *
 * The read answers a delivery with no signatures with an empty page, so nothing
 * here treats emptiness as a fault. A refusal is drawn as a refusal, because a
 * signature ledger rendered as "none yet" when the truth is "you may not see
 * them" would be read as a handover that never happened.
 *
 * ## Capture is a file, and the input is the one approved one
 *
 * The capture control renders `CaptureFileField` rather than an input of its
 * own. That component exists so a third capture surface costs nothing and widens
 * nothing: `no-unapproved-file-input` names ONE path, and adding this screen to
 * that allow-list would turn "there is one approved capture surface" into "there
 * are the approved capture surfaces", which is not a rule.
 *
 * Neither the accepted content types nor the size ceiling is stated here. Both
 * belong to the document category the server published and are enforced from it.
 *
 * ## No claim is made about what a signature means
 *
 * What is recorded is that a document was bound to this handover in a stated
 * role. Nothing here asserts whose mark the document holds or that it satisfies
 * any signature law, and nothing here fetches the document back.
 */
const selectSignatures = (envelope: DeliverySignaturesEnvelope) => envelope.signatures;

export function SignaturesPanel({
  locale,
  messages,
  deliveryId,
  receptionVisitId,
  canManage = false,
  revision = 0,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  /**
   * The visit this handover closes.
   *
   * The signature document is captured against it, because
   * `LINKABLE_ENTITY_TYPES` carries `rec.reception_visits` and does not carry
   * `sal.delivery_records` — and because the visit is what the custody chain is
   * about. It comes from the delivery record the page already read, so it is
   * never something a submitted form gets to assert.
   */
  readonly receptionVisitId?: string | undefined;
  /** Whether the caller holds the write code the attachment declares. */
  readonly canManage?: boolean;
  /** The screen's count of successful writes; a change re-reads this panel. */
  readonly revision?: number;
  /** Called after a successful capture so the screen re-reads every panel. */
  readonly onDone?: (() => void) | undefined;
}) {
  const page = usePagedList<DeliverySignaturesEnvelope, DeliverySignature>(
    deliveryId,
    listSignatures,
    selectSignatures,
    revision
  );

  return (
    <Panel
      headingId="delivery-signatures-heading"
      titleKey="delivery.signatures.heading"
      messages={messages}
      description={translate(messages, 'delivery.signatures.documentsExplain')}
    >
      {canManage && receptionVisitId !== undefined ? (
        <CaptureForm
          messages={messages}
          deliveryId={deliveryId}
          receptionVisitId={receptionVisitId}
          onDone={onDone}
        />
      ) : null}
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
          titleKey="delivery.signatures.noneTitle"
          descriptionKey="delivery.signatures.noneDescription"
        />
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {page.rows.map((signature) => (
              <li
                key={signature.id}
                className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
              >
                <span className="font-medium">
                  <SignerRoleLabel messages={messages} role={signature.signerRole} />
                </span>{' '}
                <span className="text-caption text-text-secondary">
                  {formatDateTime(signature.signedAt, locale)}
                </span>
                <p className="text-caption text-text-muted">
                  {translate(messages, 'delivery.signatures.onFile')}
                </p>
              </li>
            ))}
          </ol>
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

/**
 * Capture one signature image and bind it to this handover.
 *
 * A native `<form action={...}>` rather than a click handler, because the bytes
 * have to reach a Server Action and `FormData` is what that boundary carries.
 * React serialises the field; nothing here opens the file, hashes it, previews
 * it or builds a request body, which is what keeps the browser free of storage
 * credentials and raw object keys.
 */
function CaptureForm({
  messages,
  deliveryId,
  receptionVisitId,
  onDone,
}: {
  readonly messages: Messages;
  readonly deliveryId: string;
  readonly receptionVisitId: string;
  readonly onDone?: (() => void) | undefined;
}) {
  const [role, setRole] = useState<string>(SIGNER_ROLES[0]);
  /*
   * The submission counter, and it is load-bearing rather than bookkeeping.
   *
   * React calls `form.reset()` after a Server Action settles, and a `<select>`
   * is never re-synced by the reconciler afterwards: `updateSelect` writes
   * `defaultValue` at mount only. So a refused capture would leave the role box
   * showing its FIRST option while the operator believed they had chosen the
   * third. The counter changes the key, the key remounts the control, and the
   * default it remounts to is the choice that was actually made.
   */
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(() => {
      void captureDeliverySignature(deliveryId, receptionVisitId, formData).then((result) => {
        notifyActionResult(result, messages);
        setAttempt((previous) => previous + 1);
        if (result.status === 'success') onDone?.();
      });
    });
  };

  return (
    <form
      action={action}
      className="mb-4 flex flex-col gap-3 rounded-md border border-border-subtle p-3"
    >
      <h3 className="text-label font-medium text-text-primary">
        {translate(messages, 'delivery.signatures.captureHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'delivery.signatures.captureExplain')}
      </p>
      <SelectField
        key={`signerRole-${String(attempt)}`}
        label={translate(messages, 'delivery.signatures.signerRole')}
        name="signerRole"
        required
        defaultValue={role}
        onChange={(event) => setRole(event.target.value)}
        options={SIGNER_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, SIGNER_ROLE_LABEL_KEYS[value] ?? value),
        }))}
      />
      <CaptureFileField
        name="signatureFile"
        label={translate(messages, 'delivery.signatures.signatureFile')}
        disabled={pending}
      />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
          {translate(messages, 'delivery.signatures.captureSubmit')}
        </button>
      </div>
    </form>
  );
}
