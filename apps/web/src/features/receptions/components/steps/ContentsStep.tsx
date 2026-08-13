'use client';

import { useState, useTransition } from 'react';
import { CheckboxField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { translate } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { recordConditionEvidence } from '../../api';
import { MAX_ITEM_DESCRIPTION, MAX_LOCATION } from '../../receptions-contract';
import {
  appendSessionEvidence,
  contentsOptionalFields,
  contentsProblems,
  type ContentsDraft,
  type SessionEvidence,
} from '../../check-in/evidence';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  EvidenceReadBack,
  EvidenceSection,
  PRIMARY_BUTTON,
  SessionCaptureList,
  StepOutcome,
  WriteWithdrawn,
  useEvidenceTable,
} from './EvidencePanels';

/**
 * Vehicle contents — `rec.reception-condition-evidence [kind contents]`
 * (`P1-28-FE-016`).
 *
 * What the customer left in the vehicle, declared at handover. Recording it is
 * the workshop's protection and the customer's, which is why the declared value
 * and its currency are first-class fields rather than a note.
 *
 * ## The declaration is RESTRICTED, and reads back thinner than it went in
 *
 * `rec.vehicle_content_details` — the item description, the declared value, the
 * currency and who declared it — sits behind `iam.sensitive.view` and is NEVER
 * selected by `rec.reception-condition-evidence-list`. The read-back therefore
 * carries the quantity and the location and nothing else, and this step says so
 * rather than letting a thin row read as data loss. What this session declared
 * is shown separately, from the write's own response, labelled as a session
 * record that does not survive a reload.
 *
 * ## The currency rule is the database's, mirrored beside the control
 *
 * `ck_vehicle_content_details_currency` refuses a currency without a value — a
 * currency alone says nothing. `contentsProblems` restates that locally so the
 * refusal lands on the control the operator can clear instead of arriving as an
 * opaque 422 after a request was spent. It is a mirror, not a tightening: no
 * currency list is invented, because the platform publishes none.
 *
 * ## The witness has no referent (G-EMP)
 *
 * `witnessed_by_employee_id` is a nullable uuid with **no foreign key** and no
 * employee master exists. The only identity the platform can resolve to a name
 * is the signed-in operator, offered here as a checkbox rather than as a uuid to
 * type, with the disposition stated beside it.
 */

const IDLE: ActionState = { status: 'idle' };

const EMPTY_DRAFT: ContentsDraft = {
  itemDescription: '',
  quantity: '',
  location: '',
  declaredValue: '',
  declaredCurrency: '',
};

export function ContentsStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  session,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const table = useEvidenceTable(visitId, 'contents', `${visitId}:${recordVersion}`);
  const [captured, setCaptured] = useState<readonly SessionEvidence[]>([]);

  const [draft, setDraft] = useState<ContentsDraft>(EMPTY_DRAFT);
  const [declaredBy, setDeclaredBy] = useState<SelectedCustomer | null>(null);
  const [witnessed, setWitnessed] = useState(false);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<ContentsDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    const problems = contentsProblems(draft);
    if (Object.keys(problems).length > 0) {
      setState({
        status: 'invalid',
        messageKey: 'receptions.contents.error.check',
        fieldErrors: problems,
        attempt,
      });
      return;
    }

    startTransition(async () => {
      const result = await recordConditionEvidence(
        visitId,
        {
          kind: 'contents',
          itemDescription: draft.itemDescription.trim(),
          ...contentsOptionalFields(draft),
          ...(declaredBy === null ? {} : { declaredByPartnerId: declaredBy.id }),
          ...(witnessed ? { witnessedByEmployeeId: session.userId } : {}),
        },
        attempt
      );
      setState(result);

      const recorded = result.recorded;
      if (result.status === 'success' && recorded !== undefined) {
        setCaptured((current) =>
          appendSessionEvidence(current, {
            evidenceId: recorded.evidenceId,
            kind: 'contents',
            summary: draft.itemDescription.trim(),
          })
        );
        setDraft(EMPTY_DRAFT);
        setDeclaredBy(null);
        setWitnessed(false);
      }

      notifyActionResult(result, messages);
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
        table.refresh();
      }
    });
  };

  const errorFor = (field: string) => {
    const key = state.fieldErrors?.[field];
    return key === undefined ? undefined : translate(messages, key as never);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <EvidenceSection
        id="contents-recorded"
        messages={messages}
        headingKey="receptions.contents.heading"
      >
        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="contents"
          captured={captured}
        />
        <EvidenceReadBack locale={locale} messages={messages} kind="contents" table={table} />
      </EvidenceSection>

      <EvidenceSection
        id="contents-capture"
        messages={messages}
        headingKey="receptions.contents.captureHeading"
      >
        {writesLocked ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey="receptions.evidence.lockedNote"
          />
        ) : !capabilities.manageEvidence ? (
          <WriteWithdrawn
            locale={locale}
            messages={messages}
            messageKey="receptions.evidence.readOnly"
          />
        ) : (
          <form
            aria-label={translate(messages, 'receptions.contents.formLabel')}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-3"
          >
            <TextField
              label={translate(messages, 'receptions.contents.item')}
              required
              value={draft.itemDescription}
              maxLength={MAX_ITEM_DESCRIPTION}
              error={errorFor('itemDescription')}
              onChange={(event) => set({ itemDescription: event.target.value })}
            />
            <TextField
              label={translate(messages, 'receptions.contents.quantity')}
              optionalHint={translate(messages, 'form.optional')}
              type="number"
              min={1}
              step={1}
              dir="ltr"
              value={draft.quantity}
              error={errorFor('quantity')}
              onChange={(event) => set({ quantity: event.target.value })}
            />
            <TextField
              label={translate(messages, 'receptions.contents.location')}
              description={translate(messages, 'receptions.contents.locationHint')}
              optionalHint={translate(messages, 'form.optional')}
              value={draft.location}
              maxLength={MAX_LOCATION}
              error={errorFor('location')}
              onChange={(event) => set({ location: event.target.value })}
            />
            <TextField
              label={translate(messages, 'receptions.contents.declaredValue')}
              optionalHint={translate(messages, 'form.optional')}
              type="number"
              min={0}
              step="any"
              dir="ltr"
              value={draft.declaredValue}
              error={errorFor('declaredValue')}
              onChange={(event) => set({ declaredValue: event.target.value })}
            />
            <TextField
              label={translate(messages, 'receptions.contents.declaredCurrency')}
              description={translate(messages, 'receptions.contents.currencyHint')}
              optionalHint={translate(messages, 'form.optional')}
              value={draft.declaredCurrency}
              maxLength={3}
              dir="ltr"
              error={errorFor('declaredCurrency')}
              onChange={(event) => set({ declaredCurrency: event.target.value })}
            />

            {capabilities.readCustomers ? (
              <CustomerSelector
                locale={locale}
                messages={messages}
                name="declaredByPartnerId"
                labelKey="receptions.contents.declaredBy"
                value={declaredBy}
                onChange={setDeclaredBy}
                attempt={state.attempt ?? 0}
              />
            ) : (
              <WriteWithdrawn
                locale={locale}
                messages={messages}
                messageKey="receptions.evidence.reporterNeedsCustomerRead"
              />
            )}

            <CheckboxField
              label={`${translate(messages, 'receptions.contents.witnessed')} — ${session.displayName}`}
              description={translate(messages, 'receptions.contents.witnessedHint')}
              checked={witnessed}
              onChange={(event) => setWitnessed(event.target.checked)}
            />

            <StepOutcome messages={messages} state={state} />

            <div>
              <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                {pending
                  ? translate(messages, 'form.pending')
                  : translate(messages, 'receptions.contents.record')}
              </button>
            </div>
          </form>
        )}
      </EvidenceSection>
    </div>
  );
}
