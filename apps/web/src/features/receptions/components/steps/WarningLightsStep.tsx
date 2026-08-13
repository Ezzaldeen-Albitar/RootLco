'use client';

import { useEffect, useState, useTransition } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { recordConditionEvidence } from '../../api';
import { listWarningLightCodes, type IntakeCatalogueResult } from '../../catalogue-api';
import { MAX_MAP_TYPE, MAX_NOTE } from '../../receptions-contract';
import { appendSessionEvidence, type SessionEvidence } from '../../check-in/evidence';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  CoverageNotice,
  EvidenceReadBack,
  EvidenceSection,
  EvidenceStates,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SessionCaptureList,
  StepOutcome,
  WriteWithdrawn,
  useEvidenceTable,
} from './EvidencePanels';

/**
 * Warning lights — `rec.reception-condition-evidence [kind warning_light]`
 * (`P1-28-FE-015`).
 *
 * ## The kind is unusable until somebody populates the catalogue
 *
 * `warningLightCodeId` is a REQUIRED reference into `rec.warning_light_codes`,
 * and that table **ships zero rows** — the permanent no-fake-data policy — while
 * `RMC-11` records that no management operation exists to add any. The read
 * route (backend remediation R3) made the catalogue reachable; it did not make
 * it non-empty, and reachability is not population.
 *
 * So this step:
 *
 *   - reads the catalogue for real, every time, and renders what comes back;
 *   - with zero rows, states that the kind cannot be recorded and WHY, and
 *     renders no picker and no submit control — an empty select is a control
 *     whose only outcome is a refusal;
 *   - **invents no codes.** Not a placeholder list, not a "common lamps"
 *     shortcut, not a free-text code box that would send a value the foreign key
 *     refuses.
 *
 * The moment a tenant's catalogue has rows, the picker below is the real one and
 * the write is the real write. Nothing about this step is a stub; only the data
 * is missing, and the difference is stated on screen.
 *
 * `observedState` is a BOUNDED STRING, not an enum: the route leaves membership
 * to the database CHECK deliberately, so this is free text within the contract's
 * own bound rather than a select rendered from a list nobody agreed to.
 */

const IDLE: ActionState = { status: 'idle' };

export function WarningLightsStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const table = useEvidenceTable(visitId, 'warning_light', `${visitId}:${recordVersion}`);
  const [captured, setCaptured] = useState<readonly SessionEvidence[]>([]);
  const [catalogue, setCatalogue] = useState<IntakeCatalogueResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listWarningLightCodes().then((result) => {
      if (!cancelled) setCatalogue(result);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const canWrite = !writesLocked && capabilities.manageEvidence;

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="warning-recorded"
        messages={messages}
        headingKey="receptions.warning.heading"
      >
        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="warning_light"
          captured={captured}
        />
        <EvidenceReadBack locale={locale} messages={messages} kind="warning_light" table={table} />
      </EvidenceSection>

      <EvidenceSection
        id="warning-capture"
        messages={messages}
        headingKey="receptions.warning.captureHeading"
      >
        {catalogue === null ? (
          <EvidenceStates
            messages={messages}
            status="loading"
            correlationId={undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.status !== 'ok' ? (
          <EvidenceStates
            messages={messages}
            status={catalogue.status}
            correlationId={catalogue.correlationId ?? undefined}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : catalogue.options.length === 0 ? (
          <CoverageNotice
            locale={locale}
            messages={messages}
            kind="warning_light"
            extra={
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-caption text-text-muted" lang={locale}>
                  {translate(messages, 'receptions.warning.noManagementRoute')}
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => setAttempt((current) => current + 1)}
                    className={SECONDARY_BUTTON}
                  >
                    {translate(messages, 'state.retry')}
                  </button>
                </div>
              </div>
            }
          />
        ) : !canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : (
          <WarningLightForm
            messages={messages}
            options={catalogue.options.map((option) => ({
              value: option.id,
              label: option.code === option.name ? option.name : `${option.code} — ${option.name}`,
            }))}
            onSubmit={async (draft, submitAttempt) => {
              const result = await recordConditionEvidence(
                visitId,
                {
                  kind: 'warning_light',
                  warningLightCodeId: draft.warningLightCodeId,
                  ...(draft.observedState.trim() === ''
                    ? {}
                    : { observedState: draft.observedState.trim() }),
                  ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
                },
                submitAttempt
              );
              const recorded = result.recorded;
              if (result.status === 'success' && recorded !== undefined) {
                setCaptured((current) =>
                  appendSessionEvidence(current, {
                    evidenceId: recorded.evidenceId,
                    kind: 'warning_light',
                    summary: draft.label,
                  })
                );
              }
              notifyActionResult(result, messages);
              if (result.status === 'success' || result.status === 'conflict') {
                await refresh();
                table.refresh();
              }
              return result;
            }}
          />
        )}
      </EvidenceSection>
    </div>
  );
}

interface WarningDraft {
  readonly warningLightCodeId: string;
  readonly label: string;
  readonly observedState: string;
  readonly note: string;
}

function WarningLightForm({
  messages,
  options,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly options: readonly { value: string; label: string }[];
  readonly onSubmit: (draft: WarningDraft, attempt: number) => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<WarningDraft>({
    warningLightCodeId: '',
    label: '',
    observedState: '',
    note: '',
  });
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    if (draft.warningLightCodeId === '') {
      setState({ status: 'invalid', messageKey: 'receptions.warning.error.codeRequired', attempt });
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(draft, attempt);
      setState(result);
      if (result.status === 'success') {
        setDraft({ warningLightCodeId: '', label: '', observedState: '', note: '' });
      }
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.warning.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <SelectField
        label={translate(messages, 'receptions.warning.code')}
        required
        value={draft.warningLightCodeId}
        onChange={(event) => {
          const value = event.target.value;
          setDraft((current) => ({
            ...current,
            warningLightCodeId: value,
            label: options.find((option) => option.value === value)?.label ?? value,
          }));
        }}
        options={options}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.warning.observedState')}
        description={translate(messages, 'receptions.warning.observedStateHint')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.observedState}
        maxLength={MAX_MAP_TYPE}
        onChange={(event) =>
          setDraft((current) => ({ ...current, observedState: event.target.value }))
        }
      />
      <TextField
        label={translate(messages, 'receptions.finding.note')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.note}
        maxLength={MAX_NOTE}
        onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      />

      <StepOutcome messages={messages} state={state} />

      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.warning.record')}
        </button>
      </div>
    </form>
  );
}
