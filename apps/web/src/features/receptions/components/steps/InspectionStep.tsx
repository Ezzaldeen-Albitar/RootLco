'use client';

import { useMemo, useState, useTransition } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { recordConditionEvidence } from '../../api';
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  LEAK_TYPES,
  MAX_NOTE,
  MAX_ZONE,
  type FindingCategory,
  type FindingSeverity,
  type LeakType,
} from '../../receptions-contract';
import {
  appendSessionEvidence,
  primitiveField,
  type SessionEvidence,
} from '../../check-in/evidence';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  CoverageNotice,
  EvidenceReadBack,
  EvidenceSection,
  PRIMARY_BUTTON,
  SessionCaptureList,
  StepOutcome,
  WriteWithdrawn,
  useEvidenceTable,
} from './EvidencePanels';

/**
 * Visual inspection, condition items and leaks — `rec.reception-condition-evidence`
 * kinds `inspection`, `condition_item` and `leak` (`P1-28-FE-011`).
 *
 * ## A finding is what STAFF observed. It is never a complaint.
 *
 * `condition_item` and `complaint` are different kinds, in different steps, and
 * nothing here promotes one into the other. A finding recorded on this screen
 * is the workshop's own observation; the customer's words live in the complaint
 * step and stay labelled as the customer's.
 *
 * ## A finding hangs off an OPEN inspection, which is why the header comes first
 *
 * `rec.guard_condition_item_open` refuses a new finding unless its inspection is
 * `in_progress` — so the picker offers exactly the inspections that can accept
 * one, sourced from this visit's own read-back rather than from a value typed
 * by hand. With no open inspection the form is not rendered at all and the
 * reason is stated: a control whose only outcome is a refusal is the same defect
 * as a form offered to somebody who cannot submit it.
 *
 * There is no operation that COMPLETES an inspection — `rec.visual_inspections`
 * has no update route in the published surface — so an inspection opened here
 * stays open. That is stated rather than implied by a control that does not
 * exist.
 *
 * ## The inspector has no referent (G-EMP), and the road test has no contract
 *
 * `rec.visual_inspections.inspector_id` is NOT NULL with **no foreign key**;
 * no employee master exists anywhere in the platform. The only identity that
 * resolves to a name is the signed-in user, which is what this step submits,
 * with the disposition stated beside the control and never a uuid to type.
 *
 * Road test (`WF-10`) is an OPEN decision with no contract anywhere in the
 * platform — no operation, no report status, no agreed home. **No control here
 * is labelled "road test"**, and the step says the capability is absent instead
 * of offering something that would have to be invented.
 *
 * ## The leak type is a CHOICE, and used not to be
 *
 * It was a REQUIRED free-text box whose hint asked the operator for their own
 * words, on the reasoning that the route leaves membership to the database
 * CHECK and a select over an invented list would offer values the database
 * refuses. The reasoning was right and the conclusion was backwards:
 * `ck_leak_observations_type` admits exactly seven values
 * (`20260721102000_rec_warning_lights_leaks.sql:170`), so the box offered
 * nothing BUT values the database refuses — and because the field is required,
 * every leak an operator wrote in their own words was a guaranteed 422
 * `ERR-VAL-001`, rendered as "This value is not accepted here" with no way to
 * learn what would be. That is not a hint that could be improved; it is a step
 * nobody could complete.
 *
 * The seven types are therefore restated in `receptions-contract.ts` with the
 * migration cited, and offered as a translated choice. Nothing is invented; the
 * list is the database's own. `mapType` and `perspective` keep their
 * bounded-string treatment, because for those the list really is unknown.
 */

const IDLE: ActionState = { status: 'idle' };

export function InspectionStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  session,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const readKey = `${visitId}:${recordVersion}`;
  const inspections = useEvidenceTable(visitId, 'inspection', readKey);
  const findings = useEvidenceTable(visitId, 'condition_item', readKey);
  const leaks = useEvidenceTable(visitId, 'leak', readKey);
  const [captured, setCaptured] = useState<readonly SessionEvidence[]>([]);

  const canWrite = !writesLocked && capabilities.manageEvidence;

  /**
   * The inspections a finding may hang off: this visit's own, `in_progress`
   * only, labelled by when they started rather than by their uuid.
   *
   * Derived from the rows the read-back above is already holding — NOT a second
   * read. The list operation is `expensive-read` and the panel has just paid
   * for it.
   */
  const openInspections = useMemo(() => {
    const rows = inspections.response?.rows ?? [];
    return rows
      .filter((row) => primitiveField(row, 'inspectionStatus') === 'in_progress')
      .map((row) => {
        const startedAt = primitiveField(row, 'startedAt');
        return {
          value: row.id,
          label:
            startedAt === null
              ? translate(messages, 'receptions.inspection.unlabelled')
              : formatDateTime(startedAt, locale),
        };
      });
  }, [inspections.response, locale, messages]);

  const settle = async (result: ActionState, after: () => void) => {
    notifyActionResult(result, messages);
    if (result.status === 'success' || result.status === 'conflict') {
      // Success: the lists must show the new row. Conflict: the truth moved
      // under us, so the detail AND the lists are re-read before the operator
      // acts again (the 409 re-read rule, QA-004).
      await refresh();
      after();
    }
  };

  const remember = (entry: SessionEvidence) =>
    setCaptured((current) => appendSessionEvidence(current, entry));

  return (
    <div className="flex flex-col gap-4">
      <EvidenceSection
        id="inspection-headers"
        messages={messages}
        headingKey="receptions.inspection.heading"
      >
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.inspection.openOnlyNote')}
        </p>
        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="inspection"
          captured={captured}
        />
        <EvidenceReadBack
          locale={locale}
          messages={messages}
          kind="inspection"
          table={inspections}
        />

        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : (
          <OpenInspectionForm
            messages={messages}
            inspectorName={session.displayName}
            onSubmit={async (attempt) => {
              const result = await recordConditionEvidence(
                visitId,
                { kind: 'inspection', inspectorId: session.userId },
                attempt
              );
              if (result.status === 'success' && result.recorded) {
                remember({
                  evidenceId: result.recorded.evidenceId,
                  kind: 'inspection',
                  summary: session.displayName,
                });
              }
              await settle(result, () => {
                inspections.refresh();
                findings.refresh();
              });
              return result;
            }}
          />
        )}
        <p className="text-caption text-text-muted" lang={locale}>
          {/* G-EMP, stated where the identity is submitted. */}
          {translate(messages, 'receptions.inspection.inspectorNote')}
        </p>
      </EvidenceSection>

      <EvidenceSection
        id="inspection-findings"
        messages={messages}
        headingKey="receptions.finding.heading"
      >
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.finding.staffObservationNote')}
        </p>
        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="condition_item"
          captured={captured}
        />
        <EvidenceReadBack
          locale={locale}
          messages={messages}
          kind="condition_item"
          table={findings}
        />

        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : openInspections.length === 0 ? (
          <CoverageNotice locale={locale} messages={messages} kind="condition_item" />
        ) : (
          <FindingForm
            messages={messages}
            inspections={openInspections}
            onSubmit={async (draft, attempt) => {
              const result = await recordConditionEvidence(
                visitId,
                {
                  kind: 'condition_item',
                  inspectionId: draft.inspectionId,
                  findingCategory: draft.findingCategory as FindingCategory,
                  vehicleZone: draft.vehicleZone.trim(),
                  ...(draft.severity === '' ? {} : { severity: draft.severity as FindingSeverity }),
                  ...(draft.note.trim() === '' ? {} : { findingNote: draft.note.trim() }),
                },
                attempt
              );
              if (result.status === 'success' && result.recorded) {
                remember({
                  evidenceId: result.recorded.evidenceId,
                  kind: 'condition_item',
                  summary: `${translateDynamic(
                    messages,
                    `receptions.findingCategory.${draft.findingCategory}`
                  )} — ${draft.vehicleZone.trim()}`,
                });
              }
              await settle(result, findings.refresh);
              return result;
            }}
          />
        )}
      </EvidenceSection>

      <EvidenceSection
        id="inspection-leaks"
        messages={messages}
        headingKey="receptions.leak.heading"
      >
        <p className="text-caption text-text-muted" lang={locale}>
          {/* The contract's own sentence: "no cause and no fault is asserted". */}
          {translate(messages, 'receptions.leak.observationNote')}
        </p>
        <SessionCaptureList locale={locale} messages={messages} kind="leak" captured={captured} />
        <EvidenceReadBack locale={locale} messages={messages} kind="leak" table={leaks} />

        {!canWrite ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey={
              writesLocked ? 'receptions.evidence.lockedNote' : 'receptions.evidence.readOnly'
            }
          />
        ) : (
          <LeakForm
            messages={messages}
            onSubmit={async (draft, attempt) => {
              const result = await recordConditionEvidence(
                visitId,
                {
                  kind: 'leak',
                  leakType: draft.leakType as LeakType,
                  vehicleZone: draft.vehicleZone.trim(),
                  ...(draft.severity === '' ? {} : { severity: draft.severity as FindingSeverity }),
                  ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
                },
                attempt
              );
              if (result.status === 'success' && result.recorded) {
                remember({
                  evidenceId: result.recorded.evidenceId,
                  kind: 'leak',
                  summary: `${translateDynamic(
                    messages,
                    `receptions.leakType.${draft.leakType}`
                  )} — ${draft.vehicleZone.trim()}`,
                });
              }
              await settle(result, leaks.refresh);
              return result;
            }}
          />
        )}
      </EvidenceSection>

      {/* `WF-10` is open and no road-test contract exists anywhere in the
          platform. The absence is stated; no control is labelled for it. */}
      <p data-testid="road-test-absent" className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.inspection.roadTestAbsent')}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Forms
 * ---------------------------------------------------------------------- */

function OpenInspectionForm({
  messages,
  inspectorName,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly inspectorName: string;
  readonly onSubmit: (attempt: number) => Promise<ActionState>;
}) {
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  return (
    <form
      aria-label={translate(messages, 'receptions.inspection.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setState(await onSubmit((state.attempt ?? 0) + 1));
        });
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <p className="text-body text-text-primary">
        {translate(messages, 'receptions.inspection.inspectorIs')} {inspectorName}
      </p>
      <StepOutcome messages={messages} state={state} />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.inspection.open')}
        </button>
      </div>
    </form>
  );
}

interface FindingDraft {
  readonly inspectionId: string;
  readonly findingCategory: string;
  readonly vehicleZone: string;
  readonly severity: string;
  readonly note: string;
}

function FindingForm({
  messages,
  inspections,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly inspections: readonly { value: string; label: string }[];
  readonly onSubmit: (draft: FindingDraft, attempt: number) => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<FindingDraft>({
    inspectionId: '',
    findingCategory: '',
    vehicleZone: '',
    severity: '',
    note: '',
  });
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<FindingDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    const missing =
      draft.inspectionId === ''
        ? 'receptions.finding.error.inspectionRequired'
        : draft.findingCategory === ''
          ? 'receptions.finding.error.categoryRequired'
          : draft.vehicleZone.trim() === ''
            ? 'receptions.finding.error.zoneRequired'
            : null;
    if (missing !== null) {
      setState({ status: 'invalid', messageKey: missing, attempt });
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(draft, attempt);
      setState(result);
      if (result.status === 'success') {
        setDraft({
          inspectionId: draft.inspectionId,
          findingCategory: '',
          vehicleZone: '',
          severity: '',
          note: '',
        });
      }
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.finding.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <SelectField
        label={translate(messages, 'receptions.finding.inspection')}
        description={translate(messages, 'receptions.finding.inspectionHint')}
        required
        value={draft.inspectionId}
        onChange={(event) => set({ inspectionId: event.target.value })}
        options={inspections}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <SelectField
        label={translate(messages, 'receptions.finding.category')}
        required
        value={draft.findingCategory}
        onChange={(event) => set({ findingCategory: event.target.value })}
        options={FINDING_CATEGORIES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.findingCategory.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.finding.zone')}
        description={translate(messages, 'receptions.finding.zoneHint')}
        required
        value={draft.vehicleZone}
        maxLength={MAX_ZONE}
        onChange={(event) => set({ vehicleZone: event.target.value })}
      />
      <SelectField
        label={translate(messages, 'receptions.finding.severity')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.severity}
        onChange={(event) => set({ severity: event.target.value })}
        options={FINDING_SEVERITIES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.findingSeverity.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.finding.note')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.note}
        maxLength={MAX_NOTE}
        onChange={(event) => set({ note: event.target.value })}
      />

      <StepOutcome messages={messages} state={state} />

      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.finding.record')}
        </button>
      </div>
    </form>
  );
}

interface LeakDraft {
  readonly leakType: string;
  readonly vehicleZone: string;
  readonly severity: string;
  readonly note: string;
}

function LeakForm({
  messages,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly onSubmit: (draft: LeakDraft, attempt: number) => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<LeakDraft>({
    leakType: '',
    vehicleZone: '',
    severity: '',
    note: '',
  });
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<LeakDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    const missing =
      draft.leakType === ''
        ? 'receptions.leak.error.typeRequired'
        : draft.vehicleZone.trim() === ''
          ? 'receptions.finding.error.zoneRequired'
          : null;
    if (missing !== null) {
      setState({ status: 'invalid', messageKey: missing, attempt });
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(draft, attempt);
      setState(result);
      if (result.status === 'success') {
        setDraft({ leakType: '', vehicleZone: '', severity: '', note: '' });
      }
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.leak.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <SelectField
        label={translate(messages, 'receptions.leak.type')}
        // The seven types `ck_leak_observations_type` admits, and nothing else.
        // This was a required free-text box, which offered the operator only
        // values the database refuses; see the step docblock.
        description={translate(messages, 'receptions.leak.typeHint')}
        required
        value={draft.leakType}
        options={LEAK_TYPES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.leakType.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        onChange={(event) => set({ leakType: event.target.value })}
      />
      <TextField
        label={translate(messages, 'receptions.finding.zone')}
        description={translate(messages, 'receptions.finding.zoneHint')}
        required
        value={draft.vehicleZone}
        maxLength={MAX_ZONE}
        onChange={(event) => set({ vehicleZone: event.target.value })}
      />
      <SelectField
        label={translate(messages, 'receptions.finding.severity')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.severity}
        onChange={(event) => set({ severity: event.target.value })}
        options={FINDING_SEVERITIES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.findingSeverity.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.finding.note')}
        optionalHint={translate(messages, 'form.optional')}
        value={draft.note}
        maxLength={MAX_NOTE}
        onChange={(event) => set({ note: event.target.value })}
      />

      <StepOutcome messages={messages} state={state} />

      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.leak.record')}
        </button>
      </div>
    </form>
  );
}
