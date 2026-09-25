'use client';

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { formatDateTime } from '@/lib/format';

import { readDiscountThreshold, setDiscountThreshold } from '../api';
import { PRIMARY_BUTTON } from './shared';
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
 * included. A save that lost a race is refused, and the screen says to reload
 * rather than guessing.
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
  const companyId = context.selection?.companyId ?? null;
  const company = context.companies.find((entry) => entry.id === companyId) ?? null;

  if (companyId === null) {
    return (
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
    void readDiscountThreshold(companyId).then((next) => {
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
          <p className="text-body text-text-secondary" role="status">
            {translate(messages, 'discountThreshold.loading')}
          </p>
        ) : state.status !== 'ok' ? (
          <p className="text-body text-error" role="alert">
            {translate(
              messages,
              state.status === 'denied'
                ? 'discountThreshold.denied'
                : 'discountThreshold.unavailable'
            )}
          </p>
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

function CurrentThreshold({
  locale,
  messages,
  view,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly view: DiscountThreshold;
}) {
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
          { date: version.effectiveFrom, version: String(version.versionNo) }
        )}
      </p>
      <p className="text-caption text-text-muted">
        {formatMessage(translate(messages, 'discountThreshold.recordedBy'), {
          name: version.recordedBy.displayName ?? translate(messages, 'discountThreshold.someone'),
          when: formatDateTime(version.recordedAt, locale),
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
  const [kind, setKind] = useState<ThresholdKind>(start?.thresholdKind ?? 'amount');
  const [value, setValue] = useState(start?.thresholdValue ?? '');
  const [currency, setCurrency] = useState(start?.currency ?? '');
  const {
    errorKey: localErrorKey,
    formRef,
    refuse,
  } = useLocalRefusal({ thresholdValue: value, currency });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
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

    setBusy(true);
    const result = await setDiscountThreshold(
      companyId,
      {
        thresholdKind: kind,
        thresholdValue: trimmed,
        ...(kind === 'amount' ? { currency: code } : {}),
      },
      view.recordVersion
    );
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onSaved();
      return;
    }
    setOutcome(
      result.state.status === 'conflict'
        ? { ...result.state, messageKey: 'discountThreshold.conflict' }
        : result.state
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
        <SelectField
          label={translate(messages, 'discountThreshold.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as ThresholdKind)}
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
        <TextField
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
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={errorFor('thresholdValue')}
        />
        {kind === 'amount' ? (
          <TextField
            label={translate(messages, 'discountThreshold.currency')}
            description={translate(messages, 'discountThreshold.currencyHelp')}
            dir="ltr"
            required
            maxLength={3}
            autoComplete="off"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            error={errorFor('currency')}
          />
        ) : null}
      </div>
      {outcome && outcome.status !== 'success' && outcome.status !== 'idle' ? (
        <p role="alert" className="text-body text-error">
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
      ) : null}
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'discountThreshold.save')}
        </button>
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
      <table className="w-full text-start text-body">
        <caption className="sr-only">
          {translate(messages, 'discountThreshold.historyCaption')}
        </caption>
        <thead>
          <tr className="text-caption text-text-muted">
            <th scope="col" className="py-1 text-start font-medium">
              {translate(messages, 'discountThreshold.column.version')}
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              {translate(messages, 'discountThreshold.column.threshold')}
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              {translate(messages, 'discountThreshold.column.from')}
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              {translate(messages, 'discountThreshold.column.state')}
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              {translate(messages, 'discountThreshold.column.recordedBy')}
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((version) => (
            <tr key={version.id} className="border-t border-border">
              <td className="py-1 font-mono" dir="ltr">
                {version.versionNo}
              </td>
              <td className="py-1">
                <bdi>{describe(messages, version)}</bdi>
              </td>
              <td className="py-1 font-mono" dir="ltr">
                {version.effectiveFrom}
              </td>
              <td className="py-1">
                {translate(
                  messages,
                  version.status === 'active'
                    ? 'discountThreshold.state.active'
                    : 'discountThreshold.state.replaced'
                )}
              </td>
              <td className="py-1">
                <bdi>
                  {version.recordedBy.displayName ??
                    translate(messages, 'discountThreshold.someone')}
                </bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
