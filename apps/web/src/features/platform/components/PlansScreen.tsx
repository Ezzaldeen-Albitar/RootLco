'use client';

import { useState } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { MoneyField } from '@/components/forms/MoneyField';
import { Dialog } from '@/components/overlays/Overlays';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDate, formatInteger, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { createPlanAction, updatePlanAction, type PlanInput } from '../actions';
import { PLAN_STATUSES, TERM_PRESETS, type SubscriptionPlan } from '../types';
import { Cell, PRIMARY_BUTTON, SECONDARY_BUTTON, SimpleTable, StatusBadge } from './ui';
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
 */

const LIMIT_KINDS = ['companies', 'branches', 'users'] as const;
const FLAG_CODE = /^[a-z][a-z0-9_]{1,62}$/;

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

export function PlansScreen({
  locale,
  messages,
  plans,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly plans: readonly SubscriptionPlan[];
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [editing, setEditing] = useState<SubscriptionPlan | 'new' | null>(null);
  const features = knownFeatureCodes(plans);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button type="button" className={PRIMARY_BUTTON} onClick={() => setEditing('new')}>
          {t('platform.plans.new')}
        </button>
      </div>
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <SimpleTable
          caption={t('platform.plans.title')}
          headers={[
            t('platform.plans.code'),
            t('platform.plans.name'),
            t('platform.plans.status'),
            t('platform.plans.price'),
            t('platform.plans.term'),
            t('platform.plans.limits'),
            t('platform.plans.from'),
            t('platform.actions'),
          ]}
          empty={plans.length === 0 ? t('platform.plans.none') : null}
        >
          {plans.map((plan) => (
            <tr key={plan.id} data-testid="platform-plan" className="border-t border-border-subtle">
              <Cell>
                <span dir="ltr">{plan.planCode}</span>
              </Cell>
              <Cell>{plan.displayName ?? plan.name}</Cell>
              <Cell>
                <StatusBadge status={plan.status} messages={messages} />
              </Cell>
              <Cell end>
                {plan.listPrice && plan.currencyCode
                  ? formatMoney(
                      { amount: plan.listPrice, currency: plan.currencyCode },
                      intlLocale(locale)
                    )
                  : t('platform.plans.noPrice')}
              </Cell>
              <Cell>
                {plan.termMonths === null
                  ? '—'
                  : `${formatInteger(plan.termMonths, locale)} ${t('platform.subscription.months')}`}
              </Cell>
              <Cell>
                {LIMIT_KINDS.map((kind) => {
                  const value = limitText(plan.capacityLimits?.[kind]);
                  return (
                    <span key={kind} className="block text-caption text-text-secondary">
                      {t(`platform.capacity.${kind}`)}:{' '}
                      {value === '' ? t('platform.usage.unlimited') : value}
                    </span>
                  );
                })}
              </Cell>
              <Cell>{formatDate(plan.effectiveFrom, locale)}</Cell>
              <Cell>
                <button type="button" className={SECONDARY_BUTTON} onClick={() => setEditing(plan)}>
                  {t('platform.plans.edit')}
                </button>
              </Cell>
            </tr>
          ))}
        </SimpleTable>
      </div>

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
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    planCode,
    displayName,
    description,
    currencyCode,
    listPrice,
    term,
    extraFeature,
    status,
    effectiveFrom,
    effectiveTo,
  });
  const errors = refusalErrors;
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);
  const featureList = [...new Set([...features, ...Object.keys(entitlements)])].sort();

  const whole = (text: string) =>
    /^\d{1,7}$/.test(text.trim()) ? Number.parseInt(text.trim(), 10) : undefined;

  const submit = () => {
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
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      width="lg"
      title={t(plan ? 'platform.plans.editTitle' : 'platform.plans.newTitle')}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            name="planCode"
            label={t('platform.plans.code')}
            description={t('platform.plans.codeHint')}
            required
            dir="ltr"
            readOnly={plan !== null}
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
            error={error('planCode')}
          />
          <TextField
            name="displayName"
            label={t('platform.plans.name')}
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={error('displayName')}
          />
          <TextField
            name="currencyCode"
            label={t('platform.billing.currency')}
            maxLength={3}
            dir="ltr"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            error={error('currencyCode')}
          />
          <MoneyField
            name="listPrice"
            messages={messages}
            label={t('platform.plans.price')}
            currency={currencyCode.trim().toUpperCase()}
            value={listPrice}
            onChange={(value) => setListPrice(value)}
            error={error('listPrice')}
          />
          <TextField
            name="termMonths"
            inputMode="numeric"
            label={t('platform.subscription.termMonths')}
            description={TERM_PRESETS.join(' · ')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            error={error('termMonths')}
          />
          <SelectField
            name="status"
            label={t('platform.plans.status')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={PLAN_STATUSES.map((entry) => ({
              value: entry,
              label: t(`platform.status.${entry}`),
            }))}
            error={error('status')}
          />
          <TextField
            name="effectiveFrom"
            type="date"
            label={t('platform.plans.from')}
            required
            readOnly={plan !== null}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            error={error('effectiveFrom')}
          />
          <TextField
            name="effectiveTo"
            type="date"
            label={t('platform.plans.to')}
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
            error={error('effectiveTo')}
          />
        </div>
        <TextAreaField
          name="description"
          label={t('platform.plans.descriptionLabel')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={error('description')}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-label font-semibold text-text-primary">
            {t('platform.plans.limits')}
          </legend>
          <p className="text-supporting text-text-muted">{t('platform.plans.limitsHint')}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {LIMIT_KINDS.map((kind) => (
              <TextField
                key={kind}
                name={`limit-${kind}`}
                inputMode="numeric"
                label={t(`platform.capacity.${kind}`)}
                value={limits[kind] ?? ''}
                onChange={(event) =>
                  setLimits((current) => ({ ...current, [kind]: event.target.value }))
                }
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {featureList.map((code) => (
                <CheckboxField
                  key={code}
                  name={`feature-${code}`}
                  label={code}
                  checked={entitlements[code] === true}
                  onChange={(event) =>
                    setEntitlements((current) => ({ ...current, [code]: event.target.checked }))
                  }
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full max-w-xs">
              <TextField
                name="extraFeature"
                label={t('platform.plans.addModule')}
                dir="ltr"
                value={extraFeature}
                onChange={(event) => setExtraFeature(event.target.value)}
              />
            </div>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={!FLAG_CODE.test(extraFeature.trim())}
              onClick={() => {
                const code = extraFeature.trim();
                setEntitlements((current) => ({ ...current, [code]: true }));
                setExtraFeature('');
              }}
            >
              {t('platform.plans.addModuleSubmit')}
            </button>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            {t('overlay.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={action.pending}>
            {action.pending ? t('overlay.working') : t('platform.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
