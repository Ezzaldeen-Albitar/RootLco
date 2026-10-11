'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { workingZone } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDayInZone, formatInZone, zoneLabelAt } from '@/lib/branch-time';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { intlLocale } from '@/lib/format';

import { readDiscountThreshold, setDiscountThreshold } from '../api';
import {
  CURRENCY_CODE,
  THRESHOLD_KINDS,
  THRESHOLD_VALUE,
  type DiscountThreshold,
  type DiscountThresholdVersion,
  type ThresholdKind,
} from '../pricing-contract';

/**
 * The company discount threshold (P1-32-PRE-OD-DISC-01).
 *
 * The threshold is where a discount stops being an ordinary edit and has to be
 * approved by somebody other than the person who asked for it. This screen shows
 * the one that applies to the company in the working context — the company's own,
 * the organisation's default, or none (then every discount needs approval) — its
 * recent versions, and, for a pricing manager, a form that records the next one.
 *
 * ## A change applies from now on
 *
 * Saving never edits the current threshold: it records the next version, which
 * applies to discounts asked for from today. A discount already waiting keeps the
 * threshold it was measured against, so raising the threshold here does not approve
 * it, and lowering it does not undo an approval already given. The screen says so.
 *
 * ## There is no setting for approving your own discount
 *
 * Nobody approves their own discount. The form has no control for it because the
 * server has no field for it.
 *
 * ## Which version a save must match
 *
 * The `recordVersion` of the read travels as `If-Match` on every save, the first
 * included. A save that lost a race is refused, and the screen offers "Load the
 * latest version" rather than guessing.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-ADM4`)
 *
 * The form is the shared Material fields; the read's loading, refusal and
 * failure are the shared states (a refusal never offers a retry, an outage
 * does); the save is sent once — a second press made before the button is
 * disabled sends nothing — and a value typed and not yet saved counts as
 * unsaved work, so a branch switch asks before it discards it. Every moment is
 * written on the working branch's clock, with the clock's name beside it.
 */
export function DiscountThresholdScreen({
  locale,
  messages,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `svc.price.manage` — whether the next version can be recorded here. */
  readonly canManage: boolean;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();
  /*
   * The company of ONE named working branch. "All my branches" inside one
   * company used to answer it too, so the threshold could be written while the
   * header said this screen works in one branch (PR #467 review): a write needs
   * a concrete authorized branch, and its company is the one it belongs to.
   */
  const companyId = branch.kind === 'ready' ? branch.target.companyId : null;
  const company = context.companies.find((entry) => entry.id === companyId) ?? null;

  if (companyId === null) {
    return branch.kind === 'all' || branch.kind === 'unchosen' ? (
      <RequiresConcreteBranch
        messages={messages}
        state={branch}
        chooser
        testId="discount-threshold-needs-branch"
      />
    ) : (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'discountThreshold.chooseCompany')}
      </p>
    );
  }
  return (
    <CompanyThreshold
      key={`${companyId}:${context.version}`}
      locale={locale}
      messages={messages}
      companyId={companyId}
      companyName={company?.name ?? null}
      canManage={canManage}
    />
  );
}

function CompanyThreshold({
  locale,
  messages,
  companyId,
  companyName,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyId: string;
  readonly companyName: string | null;
  readonly canManage: boolean;
}) {
  const [state, setState] = useState<ReadState<DiscountThreshold> | null>(null);
  const [epoch, setEpoch] = useState(0);
  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    let live = true;
    void readDiscountThreshold(companyId)
      .catch((): ReadState<DiscountThreshold> => ({ status: 'unavailable', correlationId: null }))
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [companyId, epoch]);

  return (
    <div className="flex flex-col gap-4" lang={locale}>
      <section
        aria-labelledby="discount-threshold-current-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2
          id="discount-threshold-current-heading"
          className="text-body font-medium text-text-primary"
        >
          {companyName
            ? formatMessage(translate(messages, 'discountThreshold.currentHeadingFor'), {
                company: companyName,
              })
            : translate(messages, 'discountThreshold.currentHeading')}
        </h2>
        <p className="text-caption text-text-muted">
          {translate(messages, 'discountThreshold.separationNote')}
        </p>
        {state === null ? (
          <MuiLoadingState
            messages={messages}
            variant="inline"
            labelKey="discountThreshold.loading"
            testId="discount-threshold-loading"
          />
        ) : state.status !== 'ok' ? (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={state.status}
            correlationId={state.correlationId}
            onRetry={reload}
            descriptionKey={failureSentence(state.status)}
            testId="discount-threshold-failure"
          />
        ) : (
          <CurrentThreshold locale={locale} messages={messages} view={state.data} />
        )}
      </section>

      {canManage && state?.status === 'ok' ? (
        <ThresholdForm
          key={state.data.recordVersion}
          locale={locale}
          messages={messages}
          companyId={companyId}
          view={state.data}
          onSaved={reload}
        />
      ) : null}

      {state?.status === 'ok' && state.data.history.length > 0 ? (
        <History locale={locale} messages={messages} history={state.data.history} />
      ) : null}
    </div>
  );
}

/** The screen's own sentence under a failed read's shared heading. */
function failureSentence(
  status: 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found'
): keyof Messages | undefined {
  if (status === 'denied') return 'discountThreshold.denied';
  if (status === 'unavailable' || status === 'error') return 'discountThreshold.unavailable';
  return undefined;
}

function describe(messages: Messages, version: DiscountThresholdVersion): string {
  return version.thresholdKind === 'percentage'
    ? formatMessage(translate(messages, 'discountThreshold.percentageValue'), {
        value: version.thresholdValue,
      })
    : formatMessage(translate(messages, 'discountThreshold.amountValue'), {
        value: version.thresholdValue,
        currency: version.currency ?? '',
      });
}

/**
 * A calendar day and a recorded moment on the working branch's clock — the
 * clock the header names — and on UTC where no one branch's zone is known, with
 * the clock's name beside a moment so a reader can tell which clock it is.
 */
function useBranchClock(locale: Locale) {
  const context = useWorkingContext();
  const zone = workingZone(context) ?? 'UTC';
  const language = intlLocale(locale);
  return {
    day: (value: string) => formatDayInZone(value, language, zone),
    moment: (value: string) =>
      `${formatInZone(value, language, zone)} ${zoneLabelAt(value, language, zone)}`,
  };
}

function CurrentThreshold({
  locale,
  messages,
  view,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly view: DiscountThreshold;
}) {
  const clock = useBranchClock(locale);
  if (view.source === 'none') {
    return (
      <p className="text-body text-text-primary" data-testid="discount-threshold-current">
        {translate(messages, 'discountThreshold.none')}
      </p>
    );
  }
  const version = view.source === 'company' ? view.current : view.tenantDefault;
  if (version === null) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="discount-threshold-current">
      <p className="text-body text-text-primary">
        <bdi>{describe(messages, version)}</bdi>
      </p>
      <p className="text-caption text-text-muted">
        {formatMessage(
          translate(
            messages,
            view.source === 'company'
              ? 'discountThreshold.fromCompany'
              : 'discountThreshold.fromDefault'
          ),
          { date: clock.day(version.effectiveFrom), version: String(version.versionNo) }
        )}
      </p>
      <p className="text-caption text-text-muted">
        {formatMessage(translate(messages, 'discountThreshold.recordedBy'), {
          name: version.recordedBy.displayName ?? translate(messages, 'discountThreshold.someone'),
          when: clock.moment(version.recordedAt),
        })}
      </p>
    </div>
  );
}

function ThresholdForm({
  locale,
  messages,
  companyId,
  view,
  onSaved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyId: string;
  readonly view: DiscountThreshold;
  readonly onSaved: () => void;
}) {
  const start = view.current ?? view.tenantDefault;
  const startKind: ThresholdKind = start?.thresholdKind ?? 'amount';
  const startValue = start?.thresholdValue ?? '';
  const startCurrency = start?.currency ?? '';
  const [kind, setKind] = useState<ThresholdKind>(startKind);
  const [value, setValue] = useState(startValue);
  const [currency, setCurrency] = useState(startCurrency);
  const {
    errorKey: localErrorKey,
    formRef,
    refuse,
  } = useLocalRefusal({ thresholdValue: value, currency });
  const [busy, setBusy] = useState(false);
  // One save sent at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const putBack = () => {
    setKind(startKind);
    setValue(startValue);
    setCurrency(startCurrency);
    setOutcome(null);
  };
  /*
   * What was typed and not yet saved. A confirmed discard — a branch switch —
   * puts back what is stored, and the screen remounts on the new company.
   */
  const dirty =
    kind !== startKind ||
    value.trim() !== startValue.trim() ||
    (kind === 'amount' && currency.trim().toUpperCase() !== startCurrency.trim().toUpperCase());
  useUnsavedGuard(dirty, putBack);

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    const found: Record<string, string> = {};
    const trimmed = value.trim();
    if (trimmed.length === 0) found['thresholdValue'] = 'discountThreshold.valueRequired';
    else if (!THRESHOLD_VALUE.test(trimmed))
      found['thresholdValue'] = 'discountThreshold.valueFormat';
    const code = currency.trim().toUpperCase();
    if (kind === 'amount' && code.length === 0)
      found['currency'] = 'discountThreshold.currencyRequired';
    else if (kind === 'amount' && !CURRENCY_CODE.test(code))
      found['currency'] = 'discountThreshold.currencyFormat';
    refuse(found);
    if (Object.keys(found).length > 0) return;

    sending.current = true;
    setBusy(true);
    let state: ActionState;
    try {
      const result = await setDiscountThreshold(
        companyId,
        {
          thresholdKind: kind,
          thresholdValue: trimmed,
          ...(kind === 'amount' ? { currency: code } : {}),
        },
        view.recordVersion
      );
      state = result.state;
    } catch {
      // No answer came back: what was typed stays, and the button works again.
      state = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      sending.current = false;
      setBusy(false);
    }
    notifyActionResult(state, messages);
    if (state.status === 'success') {
      setOutcome(null);
      onSaved();
      return;
    }
    setOutcome(
      state.status === 'conflict' ? { ...state, messageKey: 'discountThreshold.conflict' } : state
    );
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="discount-threshold-form-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="discount-threshold-form-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'discountThreshold.formHeading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'discountThreshold.prospectiveNote')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormSelectField
          name="thresholdKind"
          label={translate(messages, 'discountThreshold.kind')}
          value={kind}
          onChange={(next) => setKind(next === 'percentage' ? 'percentage' : 'amount')}
          options={THRESHOLD_KINDS.map((option) => ({
            value: option,
            label: translate(
              messages,
              option === 'amount'
                ? 'discountThreshold.kind.amount'
                : 'discountThreshold.kind.percentage'
            ),
          }))}
        />
        <FormTextField
          name="thresholdValue"
          label={translate(
            messages,
            kind === 'amount' ? 'discountThreshold.amount' : 'discountThreshold.percentage'
          )}
          description={translate(
            messages,
            kind === 'amount' ? 'discountThreshold.amountHelp' : 'discountThreshold.percentageHelp'
          )}
          inputMode="decimal"
          dir="ltr"
          required
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={setValue}
          error={errorFor('thresholdValue')}
        />
        {kind === 'amount' ? (
          <FormTextField
            name="currency"
            label={translate(messages, 'discountThreshold.currency')}
            description={translate(messages, 'discountThreshold.currencyHelp')}
            dir="ltr"
            required
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            value={currency}
            onChange={setCurrency}
            error={errorFor('currency')}
          />
        ) : null}
      </div>
      {outcome && outcome.status !== 'success' && outcome.status !== 'idle' ? (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-body text-error">
            {translateDynamic(messages, outcome.messageKey ?? 'action.failed')}
            {outcome.correlationId ? (
              <>
                {' '}
                <span className="text-caption text-text-muted">
                  {translate(messages, 'state.correlationId')}{' '}
                  <code className="font-mono" dir="ltr">
                    {outcome.correlationId}
                  </code>
                </span>
              </>
            ) : null}
          </p>
          {outcome.status === 'conflict' ? (
            <div>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => {
                  // What is stored now replaces the stale work: the read is
                  // taken again and the form remounts on its version.
                  putBack();
                  onSaved();
                }}
              >
                {translate(messages, 'form.loadLatest')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'discountThreshold.save')}
        </Button>
      </div>
    </form>
  );
}

function History({
  locale,
  messages,
  history,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly history: readonly DiscountThresholdVersion[];
}) {
  const clock = useBranchClock(locale);
  return (
    <section
      aria-labelledby="discount-threshold-history-heading"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2
        id="discount-threshold-history-heading"
        className="text-body font-medium text-text-primary"
      >
        {translate(messages, 'discountThreshold.historyHeading')}
      </h2>
      <TableContainer>
        <Table size="small">
          <caption className="sr-only">
            {translate(messages, 'discountThreshold.historyCaption')}
          </caption>
          <TableHead>
            <TableRow>
              <TableCell scope="col">
                {translate(messages, 'discountThreshold.column.version')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'discountThreshold.column.threshold')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'discountThreshold.column.from')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'discountThreshold.column.state')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'discountThreshold.column.recordedBy')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.map((version) => (
              <TableRow key={version.id}>
                <TableCell>
                  <span className="font-mono" dir="ltr">
                    {version.versionNo}
                  </span>
                </TableCell>
                <TableCell>
                  <bdi>{describe(messages, version)}</bdi>
                </TableCell>
                <TableCell>
                  <bdi>{clock.day(version.effectiveFrom)}</bdi>
                </TableCell>
                <TableCell>
                  {translate(
                    messages,
                    version.status === 'active'
                      ? 'discountThreshold.state.active'
                      : 'discountThreshold.state.replaced'
                  )}
                </TableCell>
                <TableCell>
                  <bdi>
                    {version.recordedBy.displayName ??
                      translate(messages, 'discountThreshold.someone')}
                  </bdi>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}
