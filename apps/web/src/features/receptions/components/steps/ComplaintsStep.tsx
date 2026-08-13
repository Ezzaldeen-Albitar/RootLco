'use client';

import { useState, useTransition } from 'react';
import { SelectField, TextAreaField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { recordConditionEvidence } from '../../api';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  MAX_COMPLAINT_TEXT,
  type ComplaintCategory,
  type ComplaintSeverity,
} from '../../receptions-contract';
import { appendSessionEvidence, type SessionEvidence } from '../../check-in/evidence';
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
 */

const IDLE: ActionState = { status: 'idle' };

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

  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [complaintText, setComplaintText] = useState('');
  const [reporter, setReporter] = useState<SelectedCustomer | null>(null);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const attempt = (state.attempt ?? 0) + 1;
    if (category === '') {
      setState({
        status: 'invalid',
        messageKey: 'receptions.complaint.error.categoryRequired',
        attempt,
      });
      return;
    }
    if (complaintText.trim() === '') {
      setState({
        status: 'invalid',
        messageKey: 'receptions.complaint.error.textRequired',
        attempt,
      });
      return;
    }

    startTransition(async () => {
      const result = await recordConditionEvidence(
        visitId,
        {
          kind: 'complaint',
          category: category as ComplaintCategory,
          // Omitted rather than blanked: the route schema is `.strict()` and
          // `severity` is `optional()`, so an untouched control leaves the key
          // off the body entirely.
          ...(severity === '' ? {} : { severity: severity as ComplaintSeverity }),
          complaintText: complaintText.trim(),
          ...(reporter === null ? {} : { reportedByPartnerId: reporter.id }),
        },
        attempt
      );
      setState(result);

      const recorded = result.recorded;
      if (result.status === 'success' && recorded !== undefined) {
        // The operator's own words, held in this tab only — the read cannot
        // return them, so this is the one place they remain visible.
        setCaptured((current) =>
          appendSessionEvidence(current, {
            evidenceId: recorded.evidenceId,
            kind: 'complaint',
            summary: complaintText.trim(),
          })
        );
        setCategory('');
        setSeverity('');
        setComplaintText('');
        setReporter(null);
      }

      notifyActionResult(result, messages);
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
        table.refresh();
      }
    });
  };

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
            aria-label={translate(messages, 'receptions.complaint.formLabel')}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-3"
          >
            <SelectField
              label={translate(messages, 'receptions.complaint.category')}
              required
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              options={COMPLAINT_CATEGORIES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.complaintCategory.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
            />
            <SelectField
              label={translate(messages, 'receptions.complaint.severity')}
              description={translate(messages, 'receptions.complaint.severityHint')}
              optionalHint={translate(messages, 'form.optional')}
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              options={COMPLAINT_SEVERITIES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.complaintSeverity.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
            />
            <TextAreaField
              label={translate(messages, 'receptions.complaint.text')}
              description={translate(messages, 'receptions.complaint.textHint')}
              required
              value={complaintText}
              maxLength={MAX_COMPLAINT_TEXT}
              onChange={(event) => setComplaintText(event.target.value)}
            />

            {capabilities.readCustomers ? (
              <CustomerSelector
                locale={locale}
                messages={messages}
                name="reportedByPartnerId"
                labelKey="receptions.complaint.reportedBy"
                value={reporter}
                onChange={setReporter}
                attempt={state.attempt ?? 0}
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

            <StepOutcome messages={messages} state={state} />

            <div>
              <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                {pending
                  ? translate(messages, 'form.pending')
                  : translate(messages, 'receptions.complaint.record')}
              </button>
            </div>
          </form>
        )}
      </EvidenceSection>
    </div>
  );
}
