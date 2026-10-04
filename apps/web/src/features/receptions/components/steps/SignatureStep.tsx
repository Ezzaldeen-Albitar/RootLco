'use client';

import { useActionState, useCallback, useState, useTransition } from 'react';
import Button from '@mui/material/Button';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { IDLE, unreachable, type ActionState } from '@/lib/forms/action-result';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { ACCEPTED_VERSION_STATUS } from '@/features/attachments/attachments-contract';
import { listPartyRoles, readSignatures, recordSignatureEvent } from '../../api';
import { captureSignatureEvidence, type SignatureCaptureOutcome } from '../../signature-capture';
import {
  MAX_REPUDIATION_REASON,
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  type PartyRoleEntry,
  type SignatureEntry,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { CaptureFileField } from '../CaptureFileField';
import { EvidenceSection, EvidenceStates, SubmitButton } from './EvidencePanels';
import { PartyRoleGrid } from './PartiesStep';

/**
 * Signatures — capture, the ledger, and the two lifecycle events
 * (`P1-28-FE-018`).
 *
 * ## What replaced a statement of impossibility
 *
 * This step used to carry no control at all. `rec.reception-signature` takes
 * `signatureDocumentId` AND `signatureDocumentVersionId` — a registered document
 * and the exact version signed — and while nothing could register a document,
 * every arrangement of controls here would have been a way to be refused. The
 * step said so, and that was the right answer to the question as it then stood.
 *
 * `P1-15` built the registration chain, `P1-18` published the binding contract
 * and the Owner resolved `P1-OD-025`, so the question is a different one now.
 * What ships is the capability: a signature image becomes a document and a
 * version through `signature-capture.ts`, and the reference — never the drawn
 * bytes — is what `rec.signatures` stores.
 *
 * ## Three states, and only one of them is final
 *
 * The Owner decision is that a signature binds an EXACT ACCEPTED version, may
 * stand as a draft while its evidence is pending, and is never FINAL until that
 * evidence is accepted. The database holds the same rule in two guards, and this
 * screen renders it rather than restating it:
 *
 *   - **draft** — recorded against a version that has not been accepted.
 *     `rec.guard_signature_evidence()` admits `pending` for exactly this reason,
 *     and refuses `scanning`, `quarantined` and `rejected` outright.
 *   - **final** — an accepted version, and a deliberate second act.
 *     `rec.guard_signature_event()` refuses `finalized` unless the bound version
 *     is `accepted`, so the control appears only where it can succeed.
 *   - **repudiated** — withdrawn, with a reason, and still on the ledger.
 *
 * Finalization is NOT folded into the capture. A capture that finalized itself
 * whenever the scan happened to have finished would make the difference between
 * "signed" and "signed and verified" a matter of how fast the scanner was, and
 * would attribute an act nobody performed. They are two rows in the event ledger
 * because they are two decisions.
 *
 * ## Nothing is hidden, ever
 *
 * The ledger shows EVERY signature — superseded, repudiated, draft. Removing one
 * from the read would be the overwrite the Owner decision forbids, achieved
 * through a filter instead of an UPDATE, and it is precisely the move a screen
 * is tempted into when a signature is replaced. A replacement is a new row that
 * POINTS AT the old one; the old one stays visible and says what became of it.
 *
 * ## The file input is not here
 *
 * It is `components/CaptureFileField.tsx`, shared with the evidence step, which
 * is the one path `no-unapproved-file-input` allows. This step states no
 * accepted-type list and no size ceiling of its own — the category the SERVER
 * published owns both, and `no-invented-media-limit` is what keeps it that way.
 */

const EMPTY_SIGNATURE = {
  signerRole: '',
  purpose: '',
  signerPartnerId: '',
} as const satisfies Record<string, string>;

/** What the operator is told after a capture. `recorded` is not `final`. */
function outcomeKey(outcome: SignatureCaptureOutcome): string {
  if (outcome.status !== 'success') return 'receptions.signature.captureFailed';
  if (outcome.scannerAvailable === false) return 'receptions.signature.recordedNoScanner';
  if (outcome.versionStatus !== ACCEPTED_VERSION_STATUS) {
    return 'receptions.signature.recordedPending';
  }
  return 'receptions.signature.recordedAccepted';
}

export function SignatureStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const [outcome, setOutcome] = useState<SignatureCaptureOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const canSign = capabilities.manageSignatures && !writesLocked;

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listPartyRoles(visitId, 'active', request, cursor),
    [visitId]
  );
  const parties = useServerTable<PartyRoleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: `${visitId}:${recordVersion}`,
  });

  /*
   * The signature ledger (`rec.reception-signature-list`).
   *
   * Its own read, not a slice of the detail: a signature's lifecycle moves
   * without the visit's record version moving, so a ledger derived from the
   * detail would go stale the moment anything was finalized.
   */
  const loadLedger = useCallback(async (): Promise<ServerPage<SignatureEntry>> => {
    const read = await readSignatures(visitId);
    return {
      status: read.status === 'ok' && read.data === null ? 'not-found' : read.status,
      rows: read.status === 'ok' && read.data !== null ? read.data.signatures : [],
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
    };
  }, [visitId]);
  const ledger = useServerTable<SignatureEntry>(loadLedger, {
    initial: { ...INITIAL_REQUEST, pageSize: 50 },
    loadKey: `${visitId}:${recordVersion}`,
  });
  const signatures = ledger.response?.rows ?? [];
  const rows = parties.response?.rows ?? [];

  /*
   * The capture draft, and why the selects are remounted on every settle.
   *
   * The capture is a Server Action form: the action receives the form's own
   * data — the chosen file with it — and React resets the form DOM once the
   * action settles. A controlled `value` does NOT survive that reset on a
   * select (measured and recorded in `tests/form-reset-class.test.ts`), so each
   * select is keyed on the attempt and REMOUNTED from the draft on every
   * settle. A capture that fails because the store was unreachable therefore
   * keeps WHO signed and WHAT they signed for, and the retry cannot attribute
   * the signature to whatever the operator picked the second time; only a
   * stored capture empties the draft (the reset has already cleared the file).
   *
   * Every refusal — this screen's or the capture's own — is marked on its field,
   * the cursor goes to the first, and a correction withdraws it. The choices are
   * unsaved work. A capture whose answer never arrives is said as that.
   */
  const [draft, setDraft] = useState(EMPTY_SIGNATURE);
  const [state, capture, capturing] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const attempt = (previous.attempt ?? 0) + 1;
      const found: Record<string, string> = {};
      if (String(form.get('signerRole') ?? '') === '') found['signerRole'] = 'form.required';
      if (String(form.get('purpose') ?? '') === '') found['purpose'] = 'form.required';
      if (Object.keys(found).length > 0) {
        return { status: 'invalid', messageKey: 'form.formError', fieldErrors: found, attempt };
      }
      let result: SignatureCaptureOutcome;
      try {
        result = await captureSignatureEvidence(visitId, form);
      } catch {
        // No answer came back: said as that, every choice kept.
        return unreachable(attempt);
      }
      setOutcome(result);
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setDraft(EMPTY_SIGNATURE);
        ledger.refresh();
        await refresh();
      }
      return { ...result, attempt };
    },
    IDLE
  );
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  const dirty = draft.signerRole !== '' || draft.purpose !== '' || draft.signerPartnerId !== '';
  useUnsavedGuard(dirty, () => {
    setDraft(EMPTY_SIGNATURE);
    formRef.current?.reset();
  });
  const fieldError = (name: string): string | undefined => {
    const key = corrections.errorFor(name);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const choose = (name: keyof typeof EMPTY_SIGNATURE, value: string) => {
    corrections.noteEdited(name);
    setDraft((current) => ({ ...current, [name]: value }));
  };
  const settled = state.attempt ?? 0;

  /*
   * `partnerDisplayName` is nullable — a partner whose name this operator may
   * not read. The option is still offered, because WHO signed is a fact the
   * signature must carry whether or not this screen may print their name, and
   * the label says the name is withheld rather than printing the uuid.
   */
  const partyOptions = rows.map((row) => ({
    value: row.partnerId,
    label: row.partnerDisplayName ?? translate(messages, 'receptions.parties.nameWithheld'),
  }));

  /*
   * The names the LEDGER resolves its signers against.
   *
   * From the party read already on this screen rather than a second call, and a
   * `Map` rather than a scan because a ledger of any length would otherwise be
   * quadratic in the party list.
   *
   * It is deliberately not exhaustive, and `signerNameOf` says so. The read is
   * filtered to ACTIVE parties, so a signature given by somebody since removed
   * from the visit resolves to nothing here — which is a fact worth stating in
   * words, and never a reason to fall back to printing the uuid the row
   * carries.
   */
  const partyNames = new Map(rows.map((row) => [row.partnerId, row.partnerDisplayName]));

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="signature-ledger"
        messages={messages}
        headingKey="receptions.signature.heading"
      >
        {/*
          The read's own states, kept apart on purpose. "Nobody may read this"
          and "nothing has been signed" are different facts about a visit, and
          rendering a denial as an empty list is how a screen tells an operator
          that a signature does not exist when in truth it could not look.
        */}
        {ledger.status !== 'idle' ? (
          <EvidenceStates
            messages={messages}
            locale={locale}
            status={ledger.status}
            correlationId={ledger.correlationId}
            onRetry={ledger.refresh}
          />
        ) : signatures.length === 0 ? (
          <p data-testid="signature-none" className="text-caption" lang={locale}>
            {translate(messages, 'receptions.signature.none')}
          </p>
        ) : (
          <ul data-testid="signature-ledger" className="flex flex-col gap-2">
            {signatures.map((entry) => (
              <SignatureRow
                key={entry.id}
                locale={locale}
                messages={messages}
                visitId={visitId}
                entry={entry}
                partyNames={partyNames}
                canSign={canSign}
                onDone={() => {
                  startTransition(() => {
                    ledger.refresh();
                  });
                  void refresh();
                }}
              />
            ))}
          </ul>
        )}
      </EvidenceSection>

      <EvidenceSection
        id="signature-capture"
        messages={messages}
        headingKey="receptions.signature.captureHeading"
      >
        {canSign ? (
          <form
            ref={formRef}
            data-testid="signature-capture-form"
            action={capture}
            noValidate
            className="flex flex-col gap-3"
          >
            <FormSelectField
              key={`signerRole-${settled}`}
              label={translate(messages, 'receptions.signature.signerLabel')}
              name="signerRole"
              required
              value={draft.signerRole}
              onChange={(value) => choose('signerRole', value)}
              options={SIGNER_ROLES.map((role) => ({
                value: role,
                label: translateDynamic(messages, `receptions.signerRole.${role}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={fieldError('signerRole')}
            />
            <FormSelectField
              key={`purpose-${settled}`}
              label={translate(messages, 'receptions.signature.purposeLabel')}
              name="purpose"
              required
              value={draft.purpose}
              onChange={(value) => choose('purpose', value)}
              options={SIGNATURE_PURPOSES.map((purpose) => ({
                value: purpose,
                label: translateDynamic(messages, `receptions.signaturePurpose.${purpose}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={fieldError('purpose')}
            />
            {/*
              WHICH person signed, chosen from the parties actually on this
              visit rather than typed. Optional because `signerPartnerId` is
              nullable: an employee signing in their own role is not a partner,
              and offering a required partner field would force an operator to
              attribute a signature to somebody who did not give it.
            */}
            <FormSelectField
              key={`signerPartnerId-${settled}`}
              label={translate(messages, 'receptions.signature.partyLabel')}
              name="signerPartnerId"
              value={draft.signerPartnerId}
              onChange={(value) => choose('signerPartnerId', value)}
              options={partyOptions}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={fieldError('signerPartnerId')}
            />
            <CaptureFileField
              name="signatureFile"
              label={translate(messages, 'receptions.signature.chooseFile')}
            />
            {fieldError('signatureFile') ? (
              <p role="alert" className="text-supporting text-error">
                {fieldError('signatureFile')}
              </p>
            ) : null}
            <SubmitButton
              messages={messages}
              pending={capturing || pending}
              labelKey="receptions.signature.submit"
            />
          </form>
        ) : (
          <p
            data-testid="signature-capture-withheld"
            className="text-caption text-text-muted"
            lang={locale}
          >
            {translate(
              messages,
              writesLocked
                ? 'receptions.evidence.lockedNote'
                : 'receptions.signature.captureWithheld'
            )}
          </p>
        )}

        {outcome !== null ? (
          <p data-testid="signature-outcome" role="status" className="text-caption" lang={locale}>
            {translateDynamic(messages, outcomeKey(outcome))}
          </p>
        ) : null}
      </EvidenceSection>

      <EvidenceSection
        id="signature-parties"
        messages={messages}
        headingKey="receptions.signature.partiesHeading"
      >
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.signature.partiesNote')}
        </p>
        <PartyRoleGrid
          locale={locale}
          messages={messages}
          table={parties}
          showInterval={false}
          testId="signature-party-grid"
        />
      </EvidenceSection>
    </div>
  );
}

/**
 * One signature on the ledger, and whichever of the two events it can still
 * take.
 *
 * The controls are derived from the entry rather than from a capability alone,
 * because the database refuses on the entry's own state and a control that can
 * only fail is worse than none: `finalized` needs an ACCEPTED version and an
 * un-repudiated draft; `repudiated` needs a finalization to withdraw.
 */
/**
 * WHO the ledger says signed, in words.
 *
 * Four different facts, and a uuid is not one of the answers. `signerPartnerId`
 * is nullable by contract — an employee signing in their own role is not a
 * partner — and the party read this resolves against is filtered to ACTIVE
 * parties, so a signature given by somebody since removed from the visit is
 * genuinely unresolvable here. Each case is stated as itself rather than
 * collapsed into one hedge, because "nobody was named" and "the person named is
 * no longer on this visit" would send a reader looking in different places.
 */
function signerNameOf(
  messages: Messages,
  partyNames: ReadonlyMap<string, string | null>,
  signerPartnerId: string | null
): string {
  if (signerPartnerId === null) {
    return translate(messages, 'receptions.signature.signerUnattributed');
  }
  if (!partyNames.has(signerPartnerId)) {
    return translate(messages, 'receptions.signature.signerNotOnVisit');
  }
  return partyNames.get(signerPartnerId) ?? translate(messages, 'receptions.parties.nameWithheld');
}

function SignatureRow({
  locale,
  messages,
  visitId,
  entry,
  partyNames,
  canSign,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly entry: SignatureEntry;
  readonly partyNames: ReadonlyMap<string, string | null>;
  readonly canSign: boolean;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [showRepudiate, setShowRepudiate] = useState(false);
  const [pending, startTransition] = useTransition();

  const accepted = entry.documentVersionStatus === ACCEPTED_VERSION_STATUS;
  const canFinalize = canSign && entry.status === 'draft' && accepted;
  const canRepudiate = canSign && entry.status === 'finalized';

  return (
    <li data-testid={`signature-${entry.id}`} className="rounded-md border border-border p-2">
      <p className="text-body text-text-primary">
        {translateDynamic(messages, `receptions.signerRole.${entry.signerRole}`)}
        {' · '}
        {translateDynamic(messages, `receptions.signaturePurpose.${entry.purpose}`)}
      </p>

      {/*
        WHO signed, by what means, and when.

        All three travel on `rec.reception-signature-list` — `signerPartnerId`,
        `captureMethod`, `signedAt` — and the row used to render none of them,
        so a finalized signature read back as a role and a purpose and nothing
        else. That is not a record of who put their name to what: two people
        signing the same visit for the same purpose were indistinguishable on
        the ledger, and the means of capture, which is part of what makes a
        signature evidence, was simply absent.

        The capture method is a closed four-value vocabulary and is translated.
        The date follows the page locale. Neither the partner uuid nor the
        document uuid is ever printed.
      */}
      <p
        data-testid={`signature-attribution-${entry.id}`}
        className="text-caption text-text-secondary"
      >
        {signerNameOf(messages, partyNames, entry.signerPartnerId)}
        {' · '}
        {translateDynamic(messages, `receptions.signature.captureMethod.${entry.captureMethod}`)}
        {' · '}
        {translate(messages, 'receptions.signature.signedAtLabel')}{' '}
        {formatDateTime(entry.signedAt, locale)}
      </p>

      {/* What became of it. A repudiated signature stays on the ledger. */}
      <p data-testid={`signature-status-${entry.id}`} className="text-caption text-text-secondary">
        {translateDynamic(messages, `receptions.signature.status.${entry.status}`)}
        {entry.replacedBySignatureId !== null
          ? ` · ${translate(messages, 'receptions.signature.superseded')}`
          : ''}
      </p>

      {/*
        The lifecycle events, each shown only once it has happened.

        `finalizedAt` and `repudiatedAt` are the timestamps of the two rows in
        `rec.signature_events`, so a ledger that showed only the current status
        could say a signature is Final without ever saying WHEN it became so —
        and for a repudiation, when the party withdrew it. Both are part of the
        history the Owner decision requires to remain readable.
      */}
      {entry.finalizedAt !== null ? (
        <p
          data-testid={`signature-finalized-at-${entry.id}`}
          className="text-caption text-text-muted"
        >
          {translate(messages, 'receptions.signature.finalizedAtLabel')}{' '}
          {formatDateTime(entry.finalizedAt, locale)}
        </p>
      ) : null}
      {entry.repudiatedAt !== null ? (
        <p
          data-testid={`signature-repudiated-at-${entry.id}`}
          className="text-caption text-text-muted"
        >
          {translate(messages, 'receptions.signature.repudiatedAtLabel')}{' '}
          {formatDateTime(entry.repudiatedAt, locale)}
        </p>
      ) : null}

      {/* The bound VERSION's state — what makes a signature final or not. */}
      <p data-testid={`signature-version-${entry.id}`} className="text-caption text-text-muted">
        {translateDynamic(messages, `receptions.capture.version.${entry.documentVersionStatus}`)}
      </p>

      {entry.repudiationReason !== null ? (
        <p className="text-caption text-text-muted">{entry.repudiationReason}</p>
      ) : null}

      {canFinalize ? (
        <form
          action={async () => {
            // No `reason`: `rec.guard_signature_event()` and the adapter both
            // refuse a finalization that carries one.
            const result = await recordSignatureEvent(visitId, entry.id, {
              eventType: 'finalized',
            });
            notifyActionResult(result, messages);
            if (result.status === 'success') onDone();
          }}
        >
          <Button
            type="submit"
            variant="contained"
            size="small"
            data-testid={`signature-finalize-${entry.id}`}
            disabled={pending}
          >
            {translate(messages, 'receptions.signature.finalize')}
          </Button>
        </form>
      ) : null}

      {canSign && entry.status === 'draft' && !accepted ? (
        <p
          data-testid={`signature-finalize-blocked-${entry.id}`}
          className="text-caption text-text-muted"
          lang={locale}
        >
          {translate(messages, 'receptions.signature.finalizeBlocked')}
        </p>
      ) : null}

      {canRepudiate ? (
        showRepudiate ? (
          <form
            action={async () => {
              const result = await recordSignatureEvent(visitId, entry.id, {
                eventType: 'repudiated',
                reason,
              });
              notifyActionResult(result, messages);
              if (result.status === 'success') {
                setReason('');
                setShowRepudiate(false);
                onDone();
              }
            }}
            className="flex flex-col gap-2"
          >
            <FormTextField
              label={translate(messages, 'receptions.signature.repudiateReason')}
              required
              multiline
              rows={3}
              value={reason}
              maxLength={MAX_REPUDIATION_REASON}
              onChange={setReason}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="contained"
                color="error"
                data-testid={`signature-repudiate-submit-${entry.id}`}
                disabled={reason.trim() === ''}
              >
                {translate(messages, 'receptions.signature.repudiateSubmit')}
              </Button>
              <Button type="button" variant="outlined" onClick={() => setShowRepudiate(false)}>
                {translate(messages, 'form.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button
              type="button"
              variant="outlined"
              size="small"
              data-testid={`signature-repudiate-open-${entry.id}`}
              onClick={() => {
                startTransition(() => setShowRepudiate(true));
              }}
            >
              {translate(messages, 'receptions.signature.repudiate')}
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
