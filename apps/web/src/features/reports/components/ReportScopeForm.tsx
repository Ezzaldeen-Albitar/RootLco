'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { isKnownZone } from '@/lib/branch-time';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import {
  isReportDay,
  isReportPeriod,
  type ReportScopeOptions,
  type ReportScopeSelection,
} from '../reports-contract';

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
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-REPA`)
 *
 * The two selectors are `FormSelectField` (native, so the platform's own list)
 * and the two days are `DateField`, the MIT date picker, drawn on the BRANCH's
 * clock: the zone of the branch being chosen when the working context knows it,
 * the working branch's otherwise. A day is still a `YYYY-MM-DD` string and the
 * half-open rule is unchanged. What the picker adds is said where it happens: a
 * day only partly typed is "not finished", never "choose a day" — the box is not
 * empty — and a day the calendar does not hold is refused as one that cannot be
 * used. Enter in a day submits the form, as the native box did.
 *
 * The choices here are a FILTER, not unsaved work: nothing is written, so a
 * branch switch never asks about them (the `EntityPicker` P6 rule).
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
  /*
   * What each day box finds wrong while it holds no whole day: some parts typed
   * (`incomplete`), or a day the calendar does not hold. The picker publishes no
   * value for either, so without this a half-typed day would read as an empty
   * one.
   */
  const [dayProblems, setDayProblems] = useState<{
    readonly from: DayProblem;
    readonly to: DayProblem;
  }>({ from: null, to: null });
  // Question f: the cursor goes to the first control to correct, and a
  // complaint goes once its control changes (route sweep B3).
  const {
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
    refuse,
  } = useLocalRefusal({
    companyId: draft.companyId,
    branchId: draft.branchId,
    from: `${draft.from}|${dayProblems.from ?? ''}`,
    to: `${draft.to}|${dayProblems.to ?? ''}`,
  });
  const fixed = fixedBranchId !== null;
  /*
   * The days are typed on the clock of the branch being reported on. The
   * directory names no zone, so it is read from the working context's own
   * branches; a branch it does not hold, or a zone this browser cannot read,
   * leaves the picker on the working branch's clock, as every day field does.
   */
  const context = useWorkingContext();
  const chosenZone = context.branches.find((branch) => branch.id === draft.branchId)?.timezone;
  const zone = chosenZone !== undefined && isKnownZone(chosenZone) ? chosenZone : undefined;

  const dayRefusal = (problem: DayProblem, value: string): string | null => {
    if (problem === 'incomplete') return 'reports.run.dayIncomplete';
    if (problem !== null) return 'reports.run.dayInvalid';
    return isReportDay(value) ? null : 'reports.run.needDay';
  };

  const noteProblem = (field: 'from' | 'to') => (problem: DayProblem) =>
    setDayProblems((current) =>
      current[field] === problem ? current : { ...current, [field]: problem }
    );

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
    const fromRefusal = dayRefusal(dayProblems.from, draft.from);
    const toRefusal = dayRefusal(dayProblems.to, draft.to);
    if (fromRefusal !== null) found['from'] = fromRefusal;
    if (toRefusal !== null) found['to'] = toRefusal;
    if (fromRefusal === null && toRefusal === null && !isReportPeriod(draft.from, draft.to)) {
      // The half-open rule, said where it was broken. `to` is EXCLUDED, so an
      // equal pair covers no day at all — and an operator who meant one day has
      // to name the day after it.
      found['to'] = 'reports.run.toAfterFrom';
    }
    refuse(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ ...draft });
  };

  const errorFor = (name: string): string | undefined => {
    const key = refusalErrorKey(name);
    return key === undefined ? undefined : translate(messages, key as keyof Messages);
  };

  return (
    <form
      ref={refusalFormRef}
      noValidate
      aria-label={translate(messages, 'reports.run.formLabel')}
      className="rounded-lg border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelectField
          label={translate(messages, 'reports.run.company')}
          options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
          placeholder={translate(messages, 'form.select.placeholder')}
          required
          disabled={fixed}
          value={draft.companyId}
          onChange={(value) =>
            setDraft((current) => ({ ...current, companyId: value, branchId: '' }))
          }
          error={errorFor('companyId')}
        />
        <FormSelectField
          label={translate(messages, 'reports.run.branch')}
          options={branches
            .filter((branch) => branch.companyId === draft.companyId)
            .map((branch) => ({ value: branch.id, label: branch.name }))}
          placeholder={translate(messages, 'form.select.placeholder')}
          required
          disabled={fixed || !draft.companyId}
          value={draft.branchId}
          onChange={(value) => setDraft((current) => ({ ...current, branchId: value }))}
          error={errorFor('branchId')}
        />
        <DateField
          label={translate(messages, 'reports.run.from')}
          description={translate(messages, 'reports.run.fromHint')}
          required
          timezone={zone}
          value={isReportDay(draft.from) ? draft.from : ''}
          onChange={(value) => setDraft((current) => ({ ...current, from: value }))}
          onProblem={noteProblem('from')}
          error={errorFor('from')}
          testId="report-scope-from"
        />
        <DateField
          label={translate(messages, 'reports.run.to')}
          description={translate(messages, 'reports.run.toHint')}
          required
          timezone={zone}
          value={isReportDay(draft.to) ? draft.to : ''}
          onChange={(value) => setDraft((current) => ({ ...current, to: value }))}
          onProblem={noteProblem('to')}
          error={errorFor('to')}
          testId="report-scope-to"
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
        <Button type="submit" variant="contained">
          {translate(messages, submitKey)}
        </Button>
      </div>
    </form>
  );
}
