'use client';

import { useCallback } from 'react';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { PartyLabel } from '@/components/party/PartyLabel';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listPartyRoles } from '../../api';
import {
  MAX_SIGNATURE_HASH_INPUT,
  SIGNATURE_CAPTURE_METHODS,
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  type PartyRoleEntry,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { EvidenceSection, EvidenceStates } from './EvidencePanels';

/**
 * Signature capture — `rec.reception-signature` (`P1-28-FE-018`), the NON-IMAGE
 * half.
 *
 * ## Why there is no submit control on this screen
 *
 * `SignatureInput` requires **`signatureDocumentId` AND
 * `signatureDocumentVersionId`** — a registered signature document and the exact
 * version that was signed. Both are `uuid`, neither is optional
 * (`receptions-contract.ts:684-692`, mirrored in the route's own schema). The
 * published surface this product consumes has `shared.document-read` and **no
 * operation that registers a document**, and `P1-OD-025` is the open decision
 * that governs whether one may exist, what may be stored and where.
 *
 * So an operator cannot produce either value, and no arrangement of controls on
 * this screen changes that. Two uuid boxes, a hidden "pending" placeholder, or a
 * disabled Sign button would each advertise a capability the product does not
 * have. What ships instead is the truth, stated where the control would have
 * been, plus the parts of the operation that ARE knowable and useful now:
 *
 *   - the vocabularies it records — signer role and purpose — so the reader can
 *     see what a signature will attribute when the decision lands;
 *   - the hash bound it carries (`MAX_SIGNATURE_HASH_INPUT`);
 *   - **who is actually on this visit**, from `rec.reception-party-role-list`,
 *     because "which of these people would sign" is a real question with a real
 *     answer today.
 *
 * `rec.reception-signature` therefore stays `NOT_YET_WIRED` in the SEC-004
 * manifest. Flipping it to `REACHABLE` from this step would be a false
 * reachability claim — precisely the INT-113 defect class that gate exists to
 * catch — and this file deliberately contains no call to `recordSignature`.
 *
 * ## The media wording is fixed while the decision is open
 *
 * Nothing here says "upload" or "uploaded". The honest ceiling of the shipped
 * attachment chain is "registered, pending, never downloadable": no storage
 * provider is configured and no scanner exists, so no version can reach
 * `accepted`. The copy says that, in both languages.
 *
 * ## There is no signature READ either
 *
 * The reception surface publishes six GETs and none of them lists signatures —
 * `rec.signatures` is INSERT and SELECT only at the table, with no route. So a
 * signature recorded by some other means is not visible here, and this step
 * says so rather than showing an empty list that would read as "none exist".
 */

export function SignatureStep({ locale, messages, visitId, recordVersion }: CheckInStepProps) {
  /**
   * A vocabulary rendered as a sentence.
   *
   * The separator is the locale's, not a hard-coded comma: Arabic uses the
   * Arabic comma, and joining an Arabic list with a Latin one is the small
   * wrongness that makes translated copy read as machine output.
   */
  const listSeparator = locale === 'ar' ? '، ' : ', ';

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listPartyRoles(visitId, 'active', request, cursor),
    [visitId]
  );
  const parties = useServerTable<PartyRoleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: `${visitId}:${recordVersion}`,
  });

  const rows = parties.response?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="signature-blocked"
        messages={messages}
        headingKey="receptions.signature.heading"
      >
        <div
          role="note"
          data-testid="signature-blocked"
          className="rounded-md border border-border bg-surface-subtle p-3"
        >
          <p className="text-body text-text-primary" lang={locale}>
            {translate(messages, 'receptions.signature.blocked')}
          </p>
          <p className="mt-2 text-caption text-text-muted" lang={locale}>
            {/* "registered, pending" — never "uploaded". P1-OD-025 is open. */}
            {translate(messages, 'receptions.signature.mediaState')}
          </p>
          <p className="mt-2 text-caption text-text-muted" lang={locale}>
            {translate(messages, 'receptions.signature.decision')}
          </p>
        </div>

        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.signature.noReadBack')}
        </p>

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.signature.rolesRecorded')}
            </dt>
            <dd className="text-body text-text-primary">
              {SIGNER_ROLES.map((role) =>
                translateDynamic(messages, `receptions.signerRole.${role}`)
              ).join(listSeparator)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.signature.purposesRecorded')}
            </dt>
            <dd className="text-body text-text-primary">
              {SIGNATURE_PURPOSES.map((purpose) =>
                translateDynamic(messages, `receptions.signaturePurpose.${purpose}`)
              ).join(listSeparator)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.signature.methodsRecorded')}
            </dt>
            {/* The COUNT, not the member names. `SIGNATURE_CAPTURE_METHODS`
                contains a member whose English name is the one word this phase
                may not put on screen while `P1-OD-025` is open, and printing a
                vocabulary is not worth breaking that rule for. The bound is the
                useful part; the members become visible with the decision. */}
            <dd className="text-body text-text-primary" dir="ltr">
              {SIGNATURE_CAPTURE_METHODS.length}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.signature.hashBound')}
            </dt>
            <dd className="text-body text-text-primary" dir="ltr">
              {MAX_SIGNATURE_HASH_INPUT}
            </dd>
          </div>
        </dl>
      </EvidenceSection>

      <EvidenceSection
        id="signature-parties"
        messages={messages}
        headingKey="receptions.signature.partiesHeading"
      >
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.signature.partiesNote')}
        </p>
        {parties.status !== 'idle' ? (
          <EvidenceStates
            messages={messages}
            status={parties.status}
            correlationId={parties.correlationId}
            onRetry={parties.refresh}
          />
        ) : rows.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'receptions.parties.rolesEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <PartyLabel
                  messages={messages}
                  party={{
                    partnerName: row.partnerDisplayName,
                    partnerNumber: row.partnerDisplayNumber,
                    partnerType: null,
                  }}
                />
                <span className="text-caption text-text-secondary">
                  {translateDynamic(messages, `receptions.partyRole.${row.relationshipRole}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </EvidenceSection>
    </div>
  );
}
