'use client';

import { useState } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import {
  isReportDay,
  isReportPeriod,
  type ReportScopeOptions,
  type ReportScopeSelection,
} from '../reports-contract';
import { REPORT_PRIMARY_BUTTON } from './ReportShell';

/**
 * The one form that names a company, a branch and a period (P1-31, FE-010,
 * FE-011 … FE-014, FE-016).
 *
 * It was the report screen's own form until the operational overview needed the
 * same question asked the same way. Two copies of it would be two places where
 * the half-open rule could be stated differently, and the rule an operator gets
 * wrong is exactly the one that must not have two versions. Nothing about its
 * behaviour changed when it moved: the same four controls, the same validation in
 * the same order, the same messages, and the same refusal of an empty period
 * before a request is spent.
 *
 * ## What it decides, and what it does not
 *
 * It decides whether the four values are a well-formed selection. It decides
 * nothing about authorization: the pair is re-read from the authorized directory
 * by the Server Action, and the backend evaluates the report's own codes at that
 * pair on every run. The options it offers are the caller's own directory, passed
 * in — this component never reads.
 *
 * ## A fixed branch is a fixed branch, and it says so
 *
 * `fixedBranchId` is the FE-016 case: the branch comes from the address rather
 * than from the operator, and the two selectors are then shown DISABLED at the
 * pair they are fixed to instead of being hidden. A hidden filter is a filter an
 * operator cannot see and cannot correct, and this one changes what every figure
 * below means. The company travels with it because a company change would orphan
 * the fixed branch, which would be a selection nobody asked for.
 *
 * The fixed branch is never a literal in this source and never a default: the
 * caller resolves it against the authorized directory first and renders the
 * no-branch body when it is not there.
 */
export function ReportScopeForm({
  locale,
  messages,
  options,
  initial,
  submitKey,
  fixedBranchId = null,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly options: ReportScopeOptions;
  readonly initial: ReportScopeSelection;
  readonly submitKey: keyof Messages;
  readonly fixedBranchId?: string | null;
  readonly onSubmit: (selection: ReportScopeSelection) => void;
}) {
  const { companies, branches } = options;
  const [draft, setDraft] = useState<ReportScopeSelection>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const fixed = fixedBranchId !== null;

  const submit = () => {
    const found: Record<string, string> = {};
    if (!companies.some((company) => company.id === draft.companyId)) {
      found['companyId'] = 'reports.run.chooseCompany';
    }
    if (
      !branches.some(
        (branch) => branch.id === draft.branchId && branch.companyId === draft.companyId
      )
    ) {
      found['branchId'] = 'reports.run.chooseBranch';
    }
    if (!isReportDay(draft.from)) found['from'] = 'reports.run.needDay';
    if (!isReportDay(draft.to)) found['to'] = 'reports.run.needDay';
    if (isReportDay(draft.from) && isReportDay(draft.to) && !isReportPeriod(draft.from, draft.to)) {
      // The half-open rule, said where it was broken. `to` is EXCLUDED, so an
      // equal pair covers no day at all — and an operator who meant one day has
      // to name the day after it.
      found['to'] = 'reports.run.toAfterFrom';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ ...draft });
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key === undefined ? undefined : translate(messages, key as keyof Messages);
  };

  return (
    <form
      noValidate
      aria-label={translate(messages, 'reports.run.formLabel')}
      className="rounded-lg border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={translate(messages, 'reports.run.company')}
          options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
          placeholder={translate(messages, 'form.select.placeholder')}
          required
          disabled={fixed}
          value={draft.companyId}
          onChange={(event) =>
            setDraft((current) => ({ ...current, companyId: event.target.value, branchId: '' }))
          }
          error={errorFor('companyId')}
        />
        <SelectField
          label={translate(messages, 'reports.run.branch')}
          options={branches
            .filter((branch) => branch.companyId === draft.companyId)
            .map((branch) => ({ value: branch.id, label: branch.name }))}
          placeholder={translate(messages, 'form.select.placeholder')}
          required
          disabled={fixed || !draft.companyId}
          value={draft.branchId}
          onChange={(event) =>
            setDraft((current) => ({ ...current, branchId: event.target.value }))
          }
          error={errorFor('branchId')}
        />
        <TextField
          type="date"
          label={translate(messages, 'reports.run.from')}
          description={translate(messages, 'reports.run.fromHint')}
          required
          value={draft.from}
          onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          error={errorFor('from')}
        />
        <TextField
          type="date"
          label={translate(messages, 'reports.run.to')}
          description={translate(messages, 'reports.run.toHint')}
          required
          value={draft.to}
          onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          error={errorFor('to')}
        />
      </div>
      <p className="mt-3 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.run.periodRule')}
      </p>
      {fixed ? (
        <p className="mt-2 text-caption text-text-muted" lang={locale}>
          {translate(messages, 'reports.overview.branchFixed')}
        </p>
      ) : null}
      <div className="mt-4">
        <button type="submit" className={REPORT_PRIMARY_BUTTON}>
          {translate(messages, submitKey)}
        </button>
      </div>
    </form>
  );
}
