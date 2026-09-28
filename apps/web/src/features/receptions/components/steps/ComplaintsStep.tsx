'use client';

import { useState } from 'react';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { recordConditionEvidence } from '../../api';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  MAX_COMPLAINT_TEXT,
  type ComplaintCategory,
  type ComplaintSeverity,
} from '../../receptions-contract';
import { appendSessionEvidence, type SessionEvidence } from '../../check-in/evidence';
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
 * Customer complaint capture — `rec.reception-condition-evidence [kind complaint]`
 * (`P1-28-FE-010`).
 *
 * ## The customer's words are the customer's words. Permanently.
 *
 * This is an Owner-mandated distinction, not a copy preference: a complaint is
 * what the CUSTOMER reported, and it is not a technical fact until a technician
 * has verified it. So the capture control says whose words it is asking for,
 * the stored text is rendered back as a quotation attributed to the customer,
 * and every complaint carries **"Not yet technically verified"** in Arabic and
 * English until some later phase records a technician's verdict — which no
 * operation in this platform does yet.
 *
 * Nothing here promotes a complaint into a finding. `condition_item` is the
 * separate kind for what STAFF observed (`FE-011`), it lives in its own step,
 * and the two never merge into one list.
 *
 * ## What reads back, and what does not
 *
 * `rec.complaint_details` — the text itself — is behind `iam.sensitive.view`
 * and is NEVER selected by `rec.reception-condition-evidence-list`. The
 * read-back therefore carries the category, the severity and the reporter's
 * resolved name, and says so; what this session typed is shown separately, from
 * the write's own response, and labelled as a session record.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * The form is `useStepForm`: the category and the words are refused ON their
 * fields when missing (red, the sentence beside them, the cursor moved to the
 * first), every entry is kept, and anything typed is unsaved work. The reporter
 * is chosen by name through `CustomerPicker` (one combobox, the server's search).
 */

interface ComplaintDraft {
  readonly category: string;
  readonly severity: string;
  readonly complaintText: string;
  readonly reporter: ChosenCustomer | null;
}

const EMPTY_COMPLAINT: ComplaintDraft = {
  category: '',
  severity: '',
  complaintText: '',
  reporter: null,
};

export function ComplaintsStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const table = useEvidenceTable(visitId, 'complaint', `${visitId}:${recordVersion}`);
  const [captured, setCaptured] = useState<readonly SessionEvidence[]>([]);

  // `P1-28-SEC-002`. WF-27: this write needs `iam.sensitive.view` on top of the
  // operation's own code, so a session without it is told before it types four
  // thousand characters into a form that could only be refused.
  const gate = narrativeGate('complaint', capabilities, writesLocked);

  const form = useStepForm<ComplaintDraft>({
    messages,
    empty: EMPTY_COMPLAINT,
    errorNames: { reporter: 'reportedByPartnerId' },
    check: (draft) => {
      const found: Record<string, string> = {};
      if (draft.category === '') found['category'] = 'receptions.complaint.error.categoryRequired';
      if (draft.complaintText.trim() === '') {
        found['complaintText'] = 'receptions.complaint.error.textRequired';
      }
      return found;
    },
    send: async (draft, attempt) => {
      const result = await recordConditionEvidence(
        visitId,
        {
          kind: 'complaint',
          category: draft.category as ComplaintCategory,
          // Omitted rather than blanked: the route schema is `.strict()` and
          // `severity` is `optional()`, so an untouched control leaves the key
          // off the body entirely.
          ...(draft.severity === '' ? {} : { severity: draft.severity as ComplaintSeverity }),
          complaintText: draft.complaintText.trim(),
          ...(draft.reporter === null ? {} : { reportedByPartnerId: draft.reporter.id }),
        },
        attempt
      );
      const recorded = result.recorded;
      if (result.status === 'success' && recorded !== undefined) {
        // The operator's own words, held in this tab only — the read cannot
        // return them, so this is the one place they remain visible.
        setCaptured((current) =>
          appendSessionEvidence(current, {
            evidenceId: recorded.evidenceId,
            kind: 'complaint',
            summary: draft.complaintText.trim(),
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
  const denialKey = narrativeDenialKey('complaint', form.state);
  const { draft } = form;
  const formRef = useFocusFirstInvalid(form.state);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <EvidenceSection
        id="complaint-recorded"
        messages={messages}
        headingKey="receptions.complaint.heading"
      >
        {/* The permanent, Owner-mandated distinction, stated once at the top of
            the panel that holds the customer's words. */}
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.complaint.customerWordsNote')}
        </p>
        <p
          data-testid="complaint-unverified"
          className="rounded-md border border-border px-3 py-1.5 text-caption text-text-secondary"
          lang={locale}
        >
          {translate(messages, 'receptions.evidence.notTechnicallyVerified')}
        </p>

        <SessionCaptureList
          locale={locale}
          messages={messages}
          kind="complaint"
          captured={captured}
        />
        <EvidenceReadBack locale={locale} messages={messages} kind="complaint" table={table} />
      </EvidenceSection>

      <EvidenceSection
        id="complaint-capture"
        messages={messages}
        headingKey="receptions.complaint.captureHeading"
      >
        {gate.noticeKey !== null ? (
          <WriteWithdrawn locale={locale} messages={messages} messageKey={gate.noticeKey} />
        ) : (
          <form
            ref={formRef}
            aria-label={translate(messages, 'receptions.complaint.formLabel')}
            onSubmit={form.onSubmit}
            noValidate
            className="flex flex-col gap-3"
          >
            <FormSelectField
              label={translate(messages, 'receptions.complaint.category')}
              required
              value={draft.category}
              onChange={(value) => form.update('category', value)}
              options={COMPLAINT_CATEGORIES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.complaintCategory.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={form.fieldError('category')}
            />
            <FormSelectField
              label={translate(messages, 'receptions.complaint.severity')}
              description={translate(messages, 'receptions.complaint.severityHint')}
              value={draft.severity}
              onChange={(value) => form.update('severity', value)}
              options={COMPLAINT_SEVERITIES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.complaintSeverity.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={form.fieldError('severity')}
            />
            <FormTextField
              label={translate(messages, 'receptions.complaint.text')}
              description={translate(messages, 'receptions.complaint.textHint')}
              required
              multiline
              rows={4}
              value={draft.complaintText}
              maxLength={MAX_COMPLAINT_TEXT}
              onChange={(value) => form.update('complaintText', value)}
              error={form.fieldError('complaintText')}
            />

            {capabilities.readCustomers ? (
              <CustomerPicker
                messages={messages}
                locale={locale}
                material
                label={translate(messages, 'receptions.complaint.reportedBy')}
                value={draft.reporter}
                onChange={(chosen) => form.update('reporter', chosen)}
                canSearch
                error={form.fieldError('reportedByPartnerId')}
                // The form declares its own unsaved work, the reporter included.
                countsAsUnsaved={false}
                testId="complaint-reporter"
              />
            ) : (
              // The attribution is OPTIONAL, so the form still works without
              // `crm.customer.read` — only the naming does not. Said, not hidden.
              <WriteWithdrawn
                locale={locale}
                messages={messages}
                messageKey="receptions.evidence.reporterNeedsCustomerRead"
              />
            )}

            <StepOutcome messages={messages} state={form.state} />
            {denialKey === null ? null : (
              // The refusal is rendered by `StepOutcome` above and is not
              // rewritten here. This only NAMES the pair, and says that the
              // refusal does not distinguish them — the platform's uniform
              // denial is deliberate and this screen does not guess past it.
              <p data-testid="complaint-sensitive-denied" className="text-caption text-error">
                {translate(messages, denialKey as never)}
              </p>
            )}

            <SubmitButton
              messages={messages}
              pending={form.pending}
              labelKey="receptions.complaint.record"
            />
          </form>
        )}
      </EvidenceSection>
    </div>
  );
}
