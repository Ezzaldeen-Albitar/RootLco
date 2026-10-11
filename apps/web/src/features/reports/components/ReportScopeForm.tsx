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
 * clock when the working context knows the chosen branch's zone. A day is still
 * a `YYYY-MM-DD` string and the half-open rule is unchanged.
 *
 * ## The day typed is the day shown and the day sent, on any machine
 *
 * A calendar day has no clock, and the server resolves the period in the
 * branch's own zone whatever this browser knows — so the form's one duty is to
 * hand over exactly the day the operator typed. The picker does not make that
 * free. It holds a day as an instant on some zone, and two things moved the
 * day by one (`P1-32-PRE-OD-REPA-04`; measured, not reasoned — the REPA-03
 * text here claimed "no zone can move it", and a browser on UTC refuted it):
 *
 *  1. **A zone that changed under a mounted picker.** The picker builds what is
 *     typed on the zone it was MOUNTED with and shows it on the zone it has
 *     now, so choosing another branch and then typing 01/09 drew — and sent —
 *     31/08 whenever the new clock was west of the old one.
 *  2. **The browser's clock as the fallback.** Handed no zone, `DateField`
 *     takes the working branch's, else the browser's; on the browser's clock
 *     the picker moved the typed day back on some machines with no zone change
 *     at all (a browser in Asia/Riyadh, measured).
 *
 * So this form never hands a day picker a zone that can change under it, and
 * never leaves it to fall back:
 *
 *  - the two day fields are KEYED on their clock (`dayClock`), so another
 *    branch's clock is a new picker, mounted on that clock. A whole day already
 *    typed is kept — it is a string in this form's state, not the picker's — and
 *    a day only partly typed goes with the picker it was typed into, together
 *    with the complaint about it (`reportedProblems` is dropped with the clock);
 *  - where the chosen branch's zone is not known — missing from the working
 *    context, a name this browser cannot resolve, or no branch chosen yet — the
 *    pickers stand on `DAY_REFERENCE_ZONE`, a fixed reference used only for the
 *    calendar's arithmetic. It is not the branch's clock and is never said to
 *    be: the one thing a reader could take from it is which day the calendar
 *    marks as today, and the note under the days says that mark may be another
 *    day and that the days are used as entered (`reports.run.zoneUnknownNote`).
 *
 * The form is NOT refused for an unknown zone: what it sends cannot be wrong.
 * A moment is different — its meaning does depend on the clock — and is
 * refused: see the report screen's as-of choice.
 *
 * What the picker adds is said where it happens: a
 * day only partly typed is "not finished", never "choose a day" — the box is not
 * empty — and a day the calendar does not hold is refused as one that cannot be
 * used. Enter in a day submits the form, as the native box did.
 *
 * The choices here are a FILTER, not unsaved work: nothing is written, so a
 * branch switch never asks about them (the `EntityPicker` P6 rule).
 */
/**
 * The zone the day pickers stand on when the chosen branch's own is not known.
 *
 * A fixed reference for the calendar's arithmetic and nothing else: UTC has no
 * offset changes and no historical offsets, so a day typed on it is that day on
 * every machine. It is never presented as the branch's clock, and no instant is
 * read from it — the form sends the `YYYY-MM-DD` string.
 */
const DAY_REFERENCE_ZONE = 'UTC';

/** No complaint from either day field. */
const NO_DAY_PROBLEMS: { readonly from: DayProblem; readonly to: DayProblem } = Object.freeze({
  from: null,
  to: null,
});

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
  const [reportedProblems, setReportedProblems] = useState<{
    /** The clock of the pickers that reported them — see `dayClock`. */
    readonly clock: string;
    readonly from: DayProblem;
    readonly to: DayProblem;
  }>({ clock: '', ...NO_DAY_PROBLEMS });
  /*
   * The days are typed on the clock of the branch being reported on. The
   * directory names no zone, so it is read from the working context's own
   * branches. A branch it does not hold, a zone this browser cannot read, or no
   * branch chosen yet puts the pickers on the fixed reference instead — never
   * on the working branch's clock or the browser's — and for a chosen branch
   * the form says so (`zoneUnknown`). See "The day typed is the day shown and
   * the day sent, on any machine".
   */
  const context = useWorkingContext();
  const chosenZone = context.branches.find((branch) => branch.id === draft.branchId)?.timezone;
  const zone = chosenZone !== undefined && isKnownZone(chosenZone) ? chosenZone : undefined;
  const zoneUnknown = draft.branchId !== '' && zone === undefined;
  /*
   * The one zone both day pickers are mounted on, and their key: when it
   * changes the pickers are new ones, so no picker ever sees its zone change.
   * The marker keeps "the reference" apart from a branch that really is on UTC.
   */
  const dayZone = zone ?? DAY_REFERENCE_ZONE;
  const dayClock = zone === undefined ? `reference:${dayZone}` : `branch:${dayZone}`;
  /*
   * A complaint belongs to the picker that made it, and goes with that picker:
   * a new clock is new pickers, which have complained about nothing. Dropped
   * during render (React's pattern for state that follows a value), so no frame
   * shows an empty box under the old picker's complaint — and returning to the
   * first clock later cannot bring that complaint back.
   */
  if (reportedProblems.clock !== dayClock) {
    setReportedProblems({ clock: dayClock, ...NO_DAY_PROBLEMS });
  }
  const dayProblems = reportedProblems.clock === dayClock ? reportedProblems : NO_DAY_PROBLEMS;
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

  const dayRefusal = (problem: DayProblem, value: string): string | null => {
    if (problem === 'incomplete') return 'reports.run.dayIncomplete';
    if (problem !== null) return 'reports.run.dayInvalid';
    return isReportDay(value) ? null : 'reports.run.needDay';
  };

  const noteProblem = (field: 'from' | 'to') => (problem: DayProblem) =>
    setReportedProblems((current) => {
      const held = current.clock === dayClock ? current : { clock: dayClock, ...NO_DAY_PROBLEMS };
      return held === current && held[field] === problem ? current : { ...held, [field]: problem };
    });

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
          key={`from:${dayClock}`}
          label={translate(messages, 'reports.run.from')}
          description={translate(messages, 'reports.run.fromHint')}
          required
          timezone={dayZone}
          value={isReportDay(draft.from) ? draft.from : ''}
          onChange={(value) => setDraft((current) => ({ ...current, from: value }))}
          onProblem={noteProblem('from')}
          error={errorFor('from')}
          testId="report-scope-from"
        />
        <DateField
          key={`to:${dayClock}`}
          label={translate(messages, 'reports.run.to')}
          description={translate(messages, 'reports.run.toHint')}
          required
          timezone={dayZone}
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
      {zoneUnknown ? (
        <p
          className="mt-2 text-caption text-text-muted"
          lang={locale}
          data-testid="report-scope-zone-unknown"
        >
          {translate(messages, 'reports.run.zoneUnknownNote')}
        </p>
      ) : null}
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
