'use client';

import { useState } from 'react';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { translate } from '@/i18n/get-messages';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { recordConditionEvidence } from '../../api';
import { MAX_ITEM_DESCRIPTION, MAX_LOCATION } from '../../receptions-contract';
import {
  appendSessionEvidence,
  contentsOptionalFields,
  contentsProblems,
  type ContentsDraft,
  type SessionEvidence,
} from '../../check-in/evidence';
import { narrativeDenialKey, narrativeGate } from '../../check-in/sensitive';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  EvidenceReadBack,
  EvidenceSection,
  SessionCaptureList,
  StepOutcome,
  SubmitButton,
  WriteWithdrawn,
  useEvidenceTable,
  useStepForm,
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
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * `useStepForm`: every refusal is on its field (the cursor moved to the first,
 * the entries kept, the complaint withdrawn on correction) and anything entered
 * is unsaved work. Quantity and value stay the text typed (`FormNumberField`,
 * left to right in both languages); the declarer is chosen by name.
 */

interface ContentsForm extends ContentsDraft {
  readonly declaredBy: ChosenCustomer | null;
  readonly witnessed: boolean;
}

const EMPTY_CONTENTS: ContentsForm = {
  itemDescription: '',
  quantity: '',
  location: '',
  declaredValue: '',
  declaredCurrency: '',
  declaredBy: null,
  witnessed: false,
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
  const gate = narrativeGate('contents', capabilities, writesLocked);

  const form = useStepForm<ContentsForm>({
    messages,
    empty: EMPTY_CONTENTS,
    errorNames: { declaredBy: 'declaredByPartnerId', witnessed: 'witnessedByEmployeeId' },
    check: (draft) => contentsProblems(draft),
    refusedKey: 'receptions.contents.error.check',
    send: async (draft, attempt) => {
      const result = await recordConditionEvidence(
        visitId,
        {
          kind: 'contents',
          itemDescription: draft.itemDescription.trim(),
          ...contentsOptionalFields(draft),
          ...(draft.declaredBy === null ? {} : { declaredByPartnerId: draft.declaredBy.id }),
          ...(draft.witnessed ? { witnessedByEmployeeId: session.userId } : {}),
        },
        attempt
      );
      const recorded = result.recorded;
      if (result.status === 'success' && recorded !== undefined) {
        setCaptured((current) =>
          appendSessionEvidence(current, {
            evidenceId: recorded.evidenceId,
            kind: 'contents',
            summary: draft.itemDescription.trim(),
          })
        );
      }
      return result;
    },
    settle: async (result) => {
      notifyActionResult(result, messages);
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
        table.refresh();
      }
    },
  });
  const denialKey = narrativeDenialKey('contents', form.state);
  const { draft } = form;
  const formRef = useFocusFirstInvalid(form.state);

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
        {gate.noticeKey !== null ? (
          <WriteWithdrawn locale={locale} messages={messages} messageKey={gate.noticeKey} />
        ) : (
          <form
            ref={formRef}
            aria-label={translate(messages, 'receptions.contents.formLabel')}
            onSubmit={form.onSubmit}
            noValidate
            className="flex flex-col gap-3"
          >
            <FormTextField
              label={translate(messages, 'receptions.contents.item')}
              required
              value={draft.itemDescription}
              maxLength={MAX_ITEM_DESCRIPTION}
              error={form.fieldError('itemDescription')}
              onChange={(value) => form.update('itemDescription', value)}
            />
            <FormNumberField
              label={translate(messages, 'receptions.contents.quantity')}
              integer
              value={draft.quantity}
              error={form.fieldError('quantity')}
              onChange={(value) => form.update('quantity', value)}
            />
            <FormTextField
              label={translate(messages, 'receptions.contents.location')}
              description={translate(messages, 'receptions.contents.locationHint')}
              value={draft.location}
              maxLength={MAX_LOCATION}
              error={form.fieldError('location')}
              onChange={(value) => form.update('location', value)}
            />
            <FormNumberField
              label={translate(messages, 'receptions.contents.declaredValue')}
              value={draft.declaredValue}
              error={form.fieldError('declaredValue')}
              onChange={(value) => form.update('declaredValue', value)}
            />
            <FormTextField
              label={translate(messages, 'receptions.contents.declaredCurrency')}
              description={translate(messages, 'receptions.contents.currencyHint')}
              value={draft.declaredCurrency}
              maxLength={3}
              dir="ltr"
              error={form.fieldError('declaredCurrency')}
              onChange={(value) => form.update('declaredCurrency', value)}
            />

            {capabilities.readCustomers ? (
              <CustomerPicker
                messages={messages}
                locale={locale}
                material
                label={translate(messages, 'receptions.contents.declaredBy')}
                value={draft.declaredBy}
                onChange={(chosen) => form.update('declaredBy', chosen)}
                canSearch
                error={form.fieldError('declaredByPartnerId')}
                countsAsUnsaved={false}
                testId="contents-declared-by"
              />
            ) : (
              <WriteWithdrawn
                locale={locale}
                messages={messages}
                messageKey="receptions.evidence.reporterNeedsCustomerRead"
              />
            )}

            <FormCheckboxField
              label={`${translate(messages, 'receptions.contents.witnessed')} — ${session.displayName}`}
              description={translate(messages, 'receptions.contents.witnessedHint')}
              checked={draft.witnessed}
              onChange={(checked) => form.update('witnessed', checked)}
              error={form.fieldError('witnessedByEmployeeId')}
            />

            <StepOutcome messages={messages} state={form.state} />
            {denialKey === null ? null : (
              <p data-testid="contents-sensitive-denied" className="text-caption text-error">
                {translate(messages, denialKey as never)}
              </p>
            )}

            <SubmitButton
              messages={messages}
              pending={form.pending}
              labelKey="receptions.contents.record"
            />
          </form>
        )}
      </EvidenceSection>
    </div>
  );
}
