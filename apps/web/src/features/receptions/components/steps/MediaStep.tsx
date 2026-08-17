'use client';

import { useCallback, useState, useTransition } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { TextAreaField } from '@/components/forms/Field';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Messages } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { readCaptureContract, overrideCaptureRequirement } from '../../api';
import { captureRequirementEvidence, type CaptureOutcome } from '../../evidence-capture';
import {
  MAX_OVERRIDE_REASON,
  type CaptureContract,
  type CaptureRequirement,
  type CaptureRequirementState,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { CaptureFileField } from '../CaptureFileField';
import { EvidenceStates, PRIMARY_BUTTON, SECONDARY_BUTTON } from './EvidencePanels';

/**
 * The reception evidence area — capture, binding and the authorized override
 * (`P1-28-FE-017`).
 *
 * ## What replaced a notice
 *
 * This step used to render one statement: capture is blocked by `P1-OD-025`.
 * That was true and is not any more. The Owner resolved the decision, `P1-15`
 * built the private versioned model and `P1-18` published the binding contract,
 * so what an operator meets here is the capability rather than an account of why
 * there is not one.
 *
 * ## Three states per requirement, and only one of them is a tick
 *
 * `rec.reception-evidence-binding-list` answers the resolved policy for the
 * visit's branch — what each requirement needs, what it holds, and whether it is
 * satisfied. `satisfied` counts FINALIZED bindings only, which is the whole
 * reason this screen cannot report a visit complete on the strength of files
 * that are merely uploaded:
 *
 *   - **satisfied** — enough finalized bindings, or an override stands.
 *   - **recorded but not counted** — versions are bound and not accepted. The
 *     count is shown as `finalizedCount of minCount` with the recorded total
 *     beside it, because "3 photographs, none of them evidence yet" is a state
 *     an operator has to be able to see.
 *   - **outstanding** — nothing bound.
 *
 * ## The file input is not here either
 *
 * It is `components/CaptureFileField.tsx`, the one path `no-unapproved-file-input`
 * allows, shared with the signature step so the allowance stays at one entry as
 * capture surfaces multiply. Every other construct an upload can be built from —
 * `FileReader`, a `DataTransfer`, a drop target, a hand-set
 * `multipart/form-data`, a `.files` list — stays forbidden everywhere including
 * there, and `no-invented-media-limit` is untouched: this step states no
 * accepted-type list and no ceiling of its own, so the category the SERVER
 * published is the only policy in play.
 *
 * ## The override is a different authority, and the screen says so
 *
 * Waiving a required capture costs `rec.reception.evidence.override`, not
 * `rec.reception.evidence.manage`. A receptionist who may photograph a vehicle
 * must not thereby be able to record that no photograph was needed. Without the
 * code the control is absent with its reason stated, rather than greyed out.
 */

/** What the screen may do, resolved by the ROUTE from the session. */
export interface EvidenceCapabilities {
  readonly manageEvidence: boolean;
  readonly overrideEvidence: boolean;
}

function requirementLabel(messages: Messages, code: CaptureRequirement): string {
  return translateDynamic(messages, `receptions.capture.requirement.${code}`);
}

export function MediaStep({
  locale,
  messages,
  visitId,
  capabilities,
  writesLocked,
}: CheckInStepProps) {
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async (): Promise<ServerPage<CaptureContract>> => {
    const read = await readCaptureContract(visitId);
    return {
      status: read.status === 'ok' && read.data === null ? 'not-found' : read.status,
      rows: read.status === 'ok' && read.data !== null ? [read.data] : [],
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
    };
  }, [visitId]);
  const table = useServerTable<CaptureContract>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 1 },
    loadKey: visitId,
  });
  const contract = table.response?.rows[0] ?? null;
  const status = table.status;
  const correlationId = table.correlationId;

  if (status !== 'idle' || contract === null) {
    return (
      <section aria-labelledby="check-in-evidence-heading" className="flex flex-col gap-3">
        <h3 id="check-in-evidence-heading" className="text-section-title font-medium">
          {translate(messages, 'receptions.capture.heading')}
        </h3>
        <EvidenceStates
          messages={messages}
          status={status}
          correlationId={correlationId}
          onRetry={table.refresh}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="check-in-evidence-heading" className="flex flex-col gap-4">
      <h3 id="check-in-evidence-heading" className="text-section-title font-medium">
        {translate(messages, 'receptions.capture.heading')}
      </h3>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.capture.intro')}
      </p>

      <ul className="flex flex-col gap-3">
        {contract.requirements.map((requirement) => (
          <li
            key={requirement.requirementCode}
            data-testid={`capture-${requirement.requirementCode}`}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <RequirementRow
              locale={locale}
              messages={messages}
              visitId={visitId}
              requirement={requirement}
              contract={contract}
              canCapture={capabilities.manageEvidence && !writesLocked}
              canOverride={capabilities.overrideEvidence && !writesLocked}
              pending={pending}
              onDone={(next) => {
                setOutcome(next);
                startTransition(table.refresh);
              }}
            />
          </li>
        ))}
      </ul>

      {outcome !== null ? (
        <p data-testid="capture-outcome" role="status" className="text-caption" lang={locale}>
          {translateDynamic(messages, outcomeKey(outcome))}
        </p>
      ) : null}
    </section>
  );
}

/**
 * What the operator is told after a capture, and why `bound` is its own line.
 *
 * A file that uploaded but did not reach `accepted` has NOT satisfied its
 * requirement, and the two reasons it can be in that state are different facts:
 * no store could be read at all, or the scan has not concluded cleanly. Neither
 * is an error and both are shown as themselves.
 */
function outcomeKey(outcome: CaptureOutcome): string {
  if (outcome.status !== 'success') return 'receptions.capture.failed';
  if (outcome.stage === 'finalized') return 'receptions.capture.finalized';
  if (outcome.scannerAvailable === false) return 'receptions.capture.boundNoScanner';
  return 'receptions.capture.boundPending';
}

function RequirementRow({
  locale,
  messages,
  visitId,
  requirement,
  contract,
  canCapture,
  canOverride,
  pending,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly requirement: CaptureRequirementState;
  readonly contract: CaptureContract;
  readonly canCapture: boolean;
  readonly canOverride: boolean;
  readonly pending: boolean;
  readonly onDone: (outcome: CaptureOutcome) => void;
}) {
  const [reason, setReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const code = requirement.requirementCode;
  const bound = contract.bindings.filter((entry) => entry.requirementCode === code);
  const override = contract.overrides.find((entry) => entry.requirementCode === code);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium text-text-primary">
          {requirementLabel(messages, code)}
        </span>
        <span
          data-testid={`capture-count-${code}`}
          className="text-caption text-text-secondary"
          dir="ltr"
        >
          {requirement.finalizedCount}/{requirement.minCount}
        </span>
      </div>

      {/* The state, in words. A tick alone cannot distinguish "met" from
          "waived", and an operator reading a handover needs both. */}
      <p data-testid={`capture-state-${code}`} className="text-caption" lang={locale}>
        {translateDynamic(
          messages,
          requirement.overridden
            ? 'receptions.capture.state.overridden'
            : requirement.satisfied
              ? 'receptions.capture.state.satisfied'
              : requirement.recordedCount > requirement.finalizedCount
                ? 'receptions.capture.state.recordedNotCounted'
                : 'receptions.capture.state.outstanding'
        )}
      </p>

      {override ? (
        <p data-testid={`capture-override-${code}`} className="text-caption text-text-muted">
          {override.reason}
        </p>
      ) : null}

      {bound.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {bound.map((entry) => (
            <li key={entry.id} className="text-caption text-text-secondary">
              {/* The VERSION state, never a filename: what matters about a piece
                  of evidence is whether it is accepted, and a name is not
                  evidence of anything. */}
              {translateDynamic(
                messages,
                `receptions.capture.version.${entry.documentVersionStatus}`
              )}
              {entry.finalizedAt !== null
                ? ` · ${translate(messages, 'receptions.capture.counted')}`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {canCapture && !requirement.overridden ? (
        <form
          action={async (formData: FormData) => {
            onDone(await captureRequirementEvidence(visitId, code, formData));
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <CaptureFileField
            name="evidenceFile"
            label={translate(messages, 'receptions.capture.chooseFile')}
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(messages, 'receptions.capture.submit')}
          </button>
        </form>
      ) : null}

      {canOverride && !requirement.satisfied ? (
        showOverride ? (
          <form
            action={async () => {
              const result = await overrideCaptureRequirement(visitId, {
                requirementCode: code,
                reason,
              });
              notifyActionResult(result, messages);
              if (result.status === 'success') {
                setReason('');
                setShowOverride(false);
                onDone(result as CaptureOutcome);
              }
            }}
            className="flex flex-col gap-2"
          >
            <TextAreaField
              label={translate(messages, 'receptions.capture.overrideReason')}
              value={reason}
              maxLength={MAX_OVERRIDE_REASON}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={reason.trim() === ''} className={PRIMARY_BUTTON}>
                {translate(messages, 'receptions.capture.overrideSubmit')}
              </button>
              <button
                type="button"
                onClick={() => setShowOverride(false)}
                className={SECONDARY_BUTTON}
              >
                {translate(messages, 'form.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            data-testid={`capture-override-open-${code}`}
            onClick={() => setShowOverride(true)}
            className={SECONDARY_BUTTON}
          >
            {translate(messages, 'receptions.capture.overrideOpen')}
          </button>
        )
      ) : null}

      {!canOverride && !requirement.satisfied ? (
        <p
          data-testid={`capture-override-withheld-${code}`}
          className="text-caption text-text-muted"
          lang={locale}
        >
          {translate(messages, 'receptions.capture.overrideWithheld')}
        </p>
      ) : null}
    </div>
  );
}
