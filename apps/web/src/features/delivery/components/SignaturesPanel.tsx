'use client';

import { EmptyState } from '@/components/states/States';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listSignatures } from '../api';
import type { DeliverySignature, DeliverySignaturesEnvelope } from '../delivery-contract';
import { SignerRoleLabel } from './CodeLabel';
import { Panel, PanelFailure, PanelLoading, SECONDARY_BUTTON } from './PanelShell';
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
 */
const selectSignatures = (envelope: DeliverySignaturesEnvelope) => envelope.signatures;

export function SignaturesPanel({
  locale,
  messages,
  deliveryId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
}) {
  const page = usePagedList<DeliverySignaturesEnvelope, DeliverySignature>(
    deliveryId,
    listSignatures,
    selectSignatures
  );

  return (
    <Panel
      headingId="delivery-signatures-heading"
      titleKey="delivery.signatures.heading"
      messages={messages}
      description={translate(messages, 'delivery.signatures.documentsExplain')}
    >
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
