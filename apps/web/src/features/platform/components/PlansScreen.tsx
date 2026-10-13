'use client';

import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import type { ServerTable } from '@/components/data-table/use-server-table';
import { ZonedDateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { MuiFormFeedback } from '@/features/authentication/components/MuiFormFeedback';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDate, formatInteger, intlLocale } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';
import { createPlanAction, updatePlanAction, type PlanInput } from '../actions';
import { PLAN_STATUSES, TERM_PRESETS, type SubscriptionPlan } from '../types';
import { StatusBadge } from './ui';
import { useConsoleAction } from './use-console-action';
import { useStateRefusal } from '@/lib/forms/use-local-refusal';

/**
 * The subscription plan catalogue (P1-32-PRE-068).
 *
 * Nothing is prefilled that the operator did not choose: no price, no currency,
 * no term, no limit. A blank limit means unlimited. The module entitlements are
 * the feature codes the catalogue already uses, rendered as checkboxes; a code
 * not yet used by any plan can be added by name, and the server refuses one
 * that is not registered.
 *
 * ## On Material UI (ADR-022)
 *
 * The catalogue is the operational grid over the plans the page read. That read
 * (`platform.plan-list`) answers the WHOLE catalogue in one reply — it takes no
 * limit and returns no cursor — so the grid is told it is not paged and draws
 * no pager: there is no second page to offer. Each of the three limits has a
 * column of its own, because a row of the grid holds two lines and three limits
 * stacked in one cell would lose the third.
 *
 * The form is the shared form dialog with the Material fields. What it sends is
 * unchanged: the same document, built the same way, from the same values.
 *
 * The plan's two days are calendar days with no clock of their own; the pickers
 * are drawn on UTC, the clock the console's other days are read on, and the
 * console has no working branch to take another from.
 *
 * A day only partly typed holds no day, and the picker hands back the same
 * empty value as a box nobody touched. Sent as it stood, an end day half typed
 * would have saved the plan with no end at all. So the form refuses a day that
 * is not finished, on its own box, before anything is sent.
 */

const LIMIT_KINDS = ['companies', 'branches', 'users'] as const;
const FLAG_CODE = /^[a-z][a-z0-9_]{1,62}$/;

/** The clock the plan's day pickers are drawn on. See the note above. */
const PLAN_DAY_ZONE = 'UTC';

/** Every feature code any plan in the catalogue names, sorted. */
export function knownFeatureCodes(plans: readonly SubscriptionPlan[]): readonly string[] {
  const codes = new Set<string>();
  for (const plan of plans) {
    for (const key of Object.keys(plan.entitlementDocument ?? {})) {
      if (FLAG_CODE.test(key)) codes.add(key);
    }
  }
  return [...codes].sort();
}

function limitText(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) ? String(value) : '';
}

function planName(plan: SubscriptionPlan): string {
  return plan.displayName ?? plan.name;
}

const NOTHING = () => undefined;

export function PlansScreen({
  locale,
  messages,
  plans,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly plans: readonly SubscriptionPlan[];
}) {
  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);
  const [editing, setEditing] = useState<SubscriptionPlan | 'new' | null>(null);
  const features = knownFeatureCodes(plans);

  /*
   * The page read the catalogue on the server and handed it over whole; the grid
   * renders it and asks for nothing. So the table it is given is a settled one
   * holding every plan, with no request to change: neither a page size nor a
   * sort would reach any read.
   */
  const table = useMemo<ServerTable<SubscriptionPlan>>(
    () => ({
      request: INITIAL_REQUEST,
      setRequest: NOTHING,
      response: {
        rows: plans,
        total: plans.length,
        page: 1,
        pageSize: INITIAL_REQUEST.pageSize,
        hasMore: false,
      },
      status: 'idle',
      correlationId: undefined,
      refresh: NOTHING,
      honours: { pageSize: false, sort: false },
    }),
    [plans]
  );

  const columns = useMemo<readonly OperationalColumn<SubscriptionPlan>[]>(
    () => [
      {
        id: 'code',
        headerKey: 'platform.plans.code',
        cell: (plan) => (
          <TwoLineCell
            primary={
              <code dir="ltr" className="font-mono">
                {plan.planCode}
              </code>
            }
            testId="platform-plan-code"
          />
        ),
      },
      {
        id: 'name',
        headerKey: 'platform.plans.name',
        flex: 2,
        cell: (plan) => <TwoLineCell primary={<bdi>{planName(plan)}</bdi>} />,
      },
      {
        id: 'status',
        headerKey: 'platform.plans.status',
        cell: (plan) => <StatusBadge status={plan.status} messages={messages} />,
      },
      {
        id: 'price',
        headerKey: 'platform.plans.price',
        numeric: true,
        minChars: 14,
        cell: (plan) =>
          plan.listPrice && plan.currencyCode
            ? formatMoney(
                { amount: plan.listPrice, currency: plan.currencyCode },
                intlLocale(locale)
              )
            : t('platform.plans.noPrice'),
      },
      {
        id: 'term',
        headerKey: 'platform.plans.term',
        cell: (plan) =>
          plan.termMonths === null
            ? '—'
            : `${formatInteger(plan.termMonths, locale)} ${t('platform.subscription.months')}`,
      },
      ...LIMIT_KINDS.map((kind): OperationalColumn<SubscriptionPlan> => ({
        id: `limit-${kind}`,
        headerKey: `platform.plans.limit.${kind}`,
        numeric: true,
        cell: (plan) => {
          const value = limitText(plan.capacityLimits?.[kind]);
          return value === '' ? t('platform.usage.unlimited') : value;
        },
      })),
      {
        id: 'from',
        headerKey: 'platform.plans.from',
        minChars: 14,
        cell: (plan) => formatDate(plan.effectiveFrom, locale),
      },
    ],
    [locale, messages, t]
  );

  const rowActions = useCallback(
    (plan: SubscriptionPlan): readonly RowAction[] => [
      {
        kind: 'button',
        label: t('platform.plans.edit'),
        // Two versions of one plan share a code and a name; the day each
        // starts is what tells them apart.
        about: `${planName(plan)}, ${formatDate(plan.effectiveFrom, locale)}`,
        onClick: () => setEditing(plan),
      },
    ],
    [locale, t]
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="contained" onClick={() => setEditing('new')}>
          {t('platform.plans.new')}
        </Button>
      </div>

      <OperationalGrid<SubscriptionPlan>
        messages={messages}
        locale={locale}
        label={t('platform.plans.title')}
        columns={columns}
        rowId={(plan) => plan.id}
        table={table}
        rowActions={rowActions}
        // The catalogue's own sentence when it is empty, below.
        suppressEmptyState
        // The whole catalogue, one answer: no pager to offer.
        unpaged
        testId="platform-plans-grid"
      />
      {plans.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="platform.plans.none"
          testId="platform-plans-empty"
        />
      ) : null}

      {editing ? (
        <PlanDialog
          messages={messages}
          plan={editing === 'new' ? null : editing}
          features={features}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function PlanDialog({
  messages,
  plan,
  features,
  onClose,
}: {
  readonly messages: Messages;
  readonly plan: SubscriptionPlan | null;
  readonly features: readonly string[];
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [planCode, setPlanCode] = useState(plan?.planCode ?? '');
  const [displayName, setDisplayName] = useState(plan?.displayName ?? plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [currencyCode, setCurrencyCode] = useState(plan?.currencyCode ?? '');
  const [listPrice, setListPrice] = useState(plan?.listPrice ?? '');
  const [term, setTerm] = useState(
    plan?.termMonths === null || plan === null ? '' : String(plan.termMonths)
  );
  const [limits, setLimits] = useState<Record<string, string>>({
    companies: limitText(plan?.capacityLimits?.companies),
    branches: limitText(plan?.capacityLimits?.branches),
    users: limitText(plan?.capacityLimits?.users),
  });
  const [entitlements, setEntitlements] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(plan?.entitlementDocument ?? {})) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  });
  const [extraFeature, setExtraFeature] = useState('');
  const [status, setStatus] = useState(plan?.status ?? 'draft');
  const [effectiveFrom, setEffectiveFrom] = useState(plan?.effectiveFrom.slice(0, 10) ?? '');
  const [effectiveTo, setEffectiveTo] = useState(plan?.effectiveTo?.slice(0, 10) ?? '');
  // What each day picker finds wrong with its own entry: `'incomplete'` while
  // a day is only partly typed, the picker's own finding for a day that cannot
  // be one, and nothing once the entry is whole or blank.
  const [fromProblem, setFromProblem] = useState<DayProblem>(null);
  const [toProblem, setToProblem] = useState<DayProblem>(null);
  // The days this form refused itself, before anything was sent.
  const [unfinished, setUnfinished] = useState<{
    readonly errors: Readonly<Record<string, string>>;
    readonly attempts: number;
  }>({ errors: {}, attempts: 0 });
  const attempt = (action.state.attempt ?? 0) + unfinished.attempts;
  const refusal: ActionState =
    Object.keys(unfinished.errors).length > 0
      ? { status: 'invalid', fieldErrors: unfinished.errors, attempt }
      : { ...action.state, attempt };
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3). A day box changes when its
  // day does or when what the picker finds wrong with it does.
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(refusal, {
    planCode,
    displayName,
    description,
    currencyCode,
    listPrice,
    term,
    extraFeature,
    status,
    effectiveFrom: `${effectiveFrom}#${fromProblem ?? ''}`,
    effectiveTo: `${effectiveTo}#${toProblem ?? ''}`,
  });
  const errors = refusalErrors;
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);
  const featureList = [...new Set([...features, ...Object.keys(entitlements)])].sort();

  const whole = (text: string) =>
    /^\d{1,7}$/.test(text.trim()) ? Number.parseInt(text.trim(), 10) : undefined;

  const submit = () => {
    const notFinished: Record<string, string> = {};
    if (fromProblem !== null) notFinished.effectiveFrom = 'platform.error.date';
    if (toProblem !== null) notFinished.effectiveTo = 'platform.error.date';
    const refused = Object.keys(notFinished).length > 0;
    setUnfinished((previous) => ({
      errors: notFinished,
      attempts: previous.attempts + (refused ? 1 : 0),
    }));
    if (refused) return;
    const capacityLimits: Record<string, number> = {};
    for (const kind of LIMIT_KINDS) {
      const text = (limits[kind] ?? '').trim();
      if (text === '') continue;
      const parsed = whole(text);
      capacityLimits[kind] = parsed === undefined ? -1 : parsed;
    }
    const input: PlanInput = {
      planCode: planCode.trim(),
      displayName,
      ...(description.trim() ? { description } : {}),
      ...(listPrice.trim() ? { listPrice: listPrice.trim() } : {}),
      ...(currencyCode.trim() ? { currencyCode: currencyCode.trim().toUpperCase() } : {}),
      ...(term.trim() ? { termMonths: whole(term) ?? 0 } : {}),
      capacityLimits,
      entitlementDocument: entitlements,
      status: status as PlanInput['status'],
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
    };
    action.run(
      () => (plan ? updatePlanAction(plan.id, plan.recordVersion, input) : createPlanAction(input)),
      onClose
    );
  };

  return (
    <FormDialog
      messages={messages}
      title={t(plan ? 'platform.plans.editTitle' : 'platform.plans.newTitle')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={submit}
      formRef={refusalFormRef}
      testId="platform-plan-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormTextField
          name="planCode"
          label={t('platform.plans.code')}
          description={t('platform.plans.codeHint')}
          required
          dir="ltr"
          spellCheck={false}
          autoFocus={plan === null}
          readOnly={plan !== null}
          value={planCode}
          onChange={setPlanCode}
          error={error('planCode')}
        />
        <FormTextField
          name="displayName"
          label={t('platform.plans.name')}
          required
          autoFocus={plan !== null}
          value={displayName}
          onChange={setDisplayName}
          error={error('displayName')}
        />
        <FormTextField
          name="currencyCode"
          label={t('platform.billing.currency')}
          maxLength={3}
          dir="ltr"
          spellCheck={false}
          value={currencyCode}
          onChange={setCurrencyCode}
          error={error('currencyCode')}
        />
        <FormMoneyField
          name="listPrice"
          messages={messages}
          label={t('platform.plans.price')}
          currency={currencyCode.trim().toUpperCase()}
          value={listPrice}
          onChange={(value) => setListPrice(value)}
          error={error('listPrice')}
        />
        <FormNumberField
          name="termMonths"
          integer
          label={t('platform.subscription.termMonths')}
          description={TERM_PRESETS.join(' · ')}
          value={term}
          onChange={setTerm}
          error={error('termMonths')}
        />
        <FormSelectField
          name="status"
          label={t('platform.plans.status')}
          value={status}
          onChange={setStatus}
          options={PLAN_STATUSES.map((entry) => ({
            value: entry,
            label: t(`platform.status.${entry}`),
          }))}
          error={error('status')}
        />
        <ZonedDateField
          name="effectiveFrom"
          timezone={PLAN_DAY_ZONE}
          label={t('platform.plans.from')}
          required
          readOnly={plan !== null}
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          onProblem={setFromProblem}
          error={error('effectiveFrom')}
          testId="platform-plan-from"
        />
        <ZonedDateField
          name="effectiveTo"
          timezone={PLAN_DAY_ZONE}
          label={t('platform.plans.to')}
          value={effectiveTo}
          onChange={setEffectiveTo}
          onProblem={setToProblem}
          error={error('effectiveTo')}
          testId="platform-plan-to"
        />
      </div>
      <FormTextField
        name="description"
        multiline
        rows={3}
        label={t('platform.plans.descriptionLabel')}
        value={description}
        onChange={setDescription}
        error={error('description')}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label font-semibold text-text-primary">
          {t('platform.plans.limits')}
        </legend>
        <p className="text-supporting text-text-muted">{t('platform.plans.limitsHint')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {LIMIT_KINDS.map((kind) => (
            <FormNumberField
              key={kind}
              name={`limit-${kind}`}
              integer
              label={t(`platform.capacity.${kind}`)}
              value={limits[kind] ?? ''}
              onChange={(value) => setLimits((current) => ({ ...current, [kind]: value }))}
              error={error(`capacityLimits.${kind}`)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label font-semibold text-text-primary">
          {t('platform.plans.modules')}
        </legend>
        {featureList.length === 0 ? (
          <p className="text-supporting text-text-muted">{t('platform.plans.noModules')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-2 md:grid-cols-2">
            {featureList.map((code) => (
              <FormCheckboxField
                key={code}
                name={`feature-${code}`}
                label={code}
                checked={entitlements[code] === true}
                onChange={(checked) =>
                  setEntitlements((current) => ({ ...current, [code]: checked }))
                }
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <div className="w-full max-w-xs">
            <FormTextField
              name="extraFeature"
              label={t('platform.plans.addModule')}
              dir="ltr"
              spellCheck={false}
              value={extraFeature}
              onChange={setExtraFeature}
            />
          </div>
          <Button
            type="button"
            variant="outlined"
            disabled={!FLAG_CODE.test(extraFeature.trim())}
            onClick={() => {
              const code = extraFeature.trim();
              setEntitlements((current) => ({ ...current, [code]: true }));
              setExtraFeature('');
            }}
          >
            {t('platform.plans.addModuleSubmit')}
          </Button>
        </div>
      </fieldset>
    </FormDialog>
  );
}
