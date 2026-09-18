'use client';

import { useState } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { Dialog } from '@/components/overlays/Overlays';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { formatDate, formatDateTime, formatInteger } from '@/lib/format';
import { assignSubscriptionAction, cancelSubscriptionAction } from '../actions';
import {
  TERM_PRESETS,
  type AssignmentKind,
  type OverCapacityEntry,
  type OrganizationDetail,
  type OrganizationSubscription,
  type SubscriptionPlan,
} from '../types';
import {
  Cell,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECTION_HINT,
  Section,
  SimpleTable,
  StatusBadge,
} from './ui';
import { useConsoleAction } from './use-console-action';

/**
 * The subscription panel of an organisation (P1-32-PRE-066).
 *
 * Assign, renew, upgrade and downgrade are four acts on the same two rows, and
 * the backend records which one was meant — so each is its own button and the
 * dialog sends the act as `kind`. The term is a whole number of months: a preset
 * or a free value.
 */

type Pending =
  | { readonly type: 'assign'; readonly kind: AssignmentKind }
  | { readonly type: 'cancel'; readonly subscription: OrganizationSubscription };

/** The live assignment: active, and not ended before today. */
export function currentSubscription(
  subscriptions: readonly OrganizationSubscription[],
  today: string
): OrganizationSubscription | null {
  return (
    subscriptions.find(
      (entry) =>
        entry.status === 'active' &&
        entry.effectiveFrom.slice(0, 10) <= today &&
        (entry.effectiveTo === null || entry.effectiveTo.slice(0, 10) >= today)
    ) ??
    subscriptions.find((entry) => entry.status === 'active') ??
    null
  );
}

export function SubscriptionPanel({
  locale,
  messages,
  organization,
  plans,
  canManage,
  today,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly organization: OrganizationDetail;
  readonly plans: readonly SubscriptionPlan[] | null;
  readonly canManage: boolean;
  readonly today: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [pending, setPending] = useState<Pending | null>(null);
  const current = currentSubscription(organization.subscriptions, today);
  const manageable = canManage && plans !== null && organization.status !== 'closed';

  const actions = manageable ? (
    current ? (
      <>
        {(['renewed', 'upgraded', 'downgraded'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => setPending({ type: 'assign', kind })}
          >
            {t(`platform.subscription.act.${kind}`)}
          </button>
        ))}
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => setPending({ type: 'cancel', subscription: current })}
        >
          {t('platform.subscription.act.cancel')}
        </button>
      </>
    ) : (
      <button
        type="button"
        className={SECONDARY_BUTTON}
        onClick={() => setPending({ type: 'assign', kind: 'assigned' })}
      >
        {t('platform.subscription.act.assigned')}
      </button>
    )
  ) : null;

  return (
    <Section title={t('platform.subscription.title')} actions={actions}>
      {current ? (
        <dl data-testid="platform-current-plan" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.subscription.plan')}
            </dt>
            <dd className="text-body font-medium text-text-primary">{current.planName}</dd>
          </div>
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.subscription.starts')}
            </dt>
            <dd className="text-body text-text-primary">
              {formatDate(current.effectiveFrom, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.subscription.ends')}
            </dt>
            <dd className="text-body text-text-primary">
              {current.effectiveTo
                ? formatDate(current.effectiveTo, locale)
                : t('platform.subscription.openEnded')}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-body text-text-muted">{t('platform.subscription.none')}</p>
      )}

      <h3 className="mt-4 mb-2 text-label font-semibold text-text-secondary">
        {t('platform.subscription.history')}
      </h3>
      <SimpleTable
        caption={t('platform.subscription.history')}
        headers={[
          t('platform.subscription.plan'),
          t('platform.subscription.status'),
          t('platform.subscription.starts'),
          t('platform.subscription.ends'),
        ]}
        empty={organization.subscriptions.length === 0 ? t('platform.subscription.none') : null}
      >
        {organization.subscriptions.map((entry) => (
          <tr key={entry.id} className="border-t border-border-subtle">
            <Cell>{entry.planName}</Cell>
            <Cell>
              <StatusBadge status={entry.status} messages={messages} />
            </Cell>
            <Cell>{formatDate(entry.effectiveFrom, locale)}</Cell>
            <Cell>
              {entry.effectiveTo
                ? formatDate(entry.effectiveTo, locale)
                : t('platform.subscription.openEnded')}
            </Cell>
          </tr>
        ))}
      </SimpleTable>

      <h3 className="mt-4 mb-2 text-label font-semibold text-text-secondary">
        {t('platform.subscription.events')}
      </h3>
      <SimpleTable
        caption={t('platform.subscription.events')}
        headers={[
          t('platform.subscription.when'),
          t('platform.subscription.act'),
          t('platform.subscription.change'),
          t('platform.subscription.reason'),
        ]}
        empty={
          organization.subscriptionEvents.length === 0 ? t('platform.subscription.noEvents') : null
        }
      >
        {organization.subscriptionEvents.map((event) => (
          <tr key={event.id} className="border-t border-border-subtle">
            <Cell>{formatDateTime(event.occurredAt, locale)}</Cell>
            <Cell>
              {t(
                `platform.subscription.event.${['assigned', 'renewed', 'upgraded', 'downgraded', 'cancelled', 'suspended', 'reactivated'].includes(event.eventKind) ? event.eventKind : 'other'}`
              )}
            </Cell>
            <Cell>{[event.fromPlanCode, event.toPlanCode].filter(Boolean).join(' → ') || '—'}</Cell>
            <Cell>{event.reason}</Cell>
          </tr>
        ))}
      </SimpleTable>

      {pending?.type === 'assign' && plans ? (
        <AssignDialog
          locale={locale}
          messages={messages}
          tenantId={organization.id}
          kind={pending.kind}
          plans={plans}
          current={current}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending?.type === 'cancel' ? (
        <CancelDialog
          messages={messages}
          tenantId={organization.id}
          subscription={pending.subscription}
          onClose={() => setPending(null)}
        />
      ) : null}
    </Section>
  );
}

function AssignDialog({
  locale,
  messages,
  tenantId,
  kind,
  plans,
  current,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenantId: string;
  readonly kind: AssignmentKind;
  readonly plans: readonly SubscriptionPlan[];
  readonly current: OrganizationSubscription | null;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const active = plans.filter((plan) => plan.status === 'active');
  const [planCode, setPlanCode] = useState(kind === 'renewed' && current ? current.planCode : '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [preset, setPreset] = useState<string>('12');
  const [customTerm, setCustomTerm] = useState('');
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [acceptedReason, setAcceptedReason] = useState('');
  const errors = action.state.fieldErrors ?? {};
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);
  // What the backend refused with, kind by kind. It appears only after a
  // refusal: the console never predicts a ceiling, because the numbers that
  // decide one are the database's and are counted at the moment of the write.
  const overCapacity: readonly OverCapacityEntry[] =
    ('overCapacity' in action.state
      ? ((action.state as { readonly overCapacity?: readonly OverCapacityEntry[] }).overCapacity ??
        [])
      : []) ?? [];

  const submit = () => {
    const termText = preset === 'other' ? customTerm.trim() : preset;
    const termMonths = /^\d{1,3}$/.test(termText) ? Number.parseInt(termText, 10) : Number.NaN;
    action.run(
      () =>
        assignSubscriptionAction(tenantId, {
          planCode,
          effectiveFrom,
          termMonths,
          kind,
          reason,
          ...(accepted ? { acceptOverCapacity: true, overCapacityReason: acceptedReason } : {}),
        }),
      onClose
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t(`platform.subscription.act.${kind}`)}
      description={t('platform.subscription.dialogHint')}
    >
      <form
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
        <SelectField
          name="planCode"
          label={t('platform.subscription.plan')}
          required
          value={planCode}
          placeholder={t('platform.provision.choose')}
          onChange={(event) => setPlanCode(event.target.value)}
          options={active.map((plan) => ({
            value: plan.planCode,
            label: plan.displayName ?? plan.name,
          }))}
          error={error('planCode')}
        />
        <TextField
          name="effectiveFrom"
          type="date"
          label={t('platform.subscription.starts')}
          required
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          error={error('effectiveFrom')}
        />
        <SelectField
          name="termPreset"
          label={t('platform.subscription.term')}
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          options={[
            ...TERM_PRESETS.map((months) => ({
              value: String(months),
              label: `${months} ${t('platform.subscription.months')}`,
            })),
            { value: 'other', label: t('platform.subscription.otherTerm') },
          ]}
          error={preset === 'other' ? undefined : error('termMonths')}
        />
        {preset === 'other' ? (
          <TextField
            name="termMonths"
            inputMode="numeric"
            label={t('platform.subscription.termMonths')}
            required
            value={customTerm}
            onChange={(event) => setCustomTerm(event.target.value)}
            error={error('termMonths')}
          />
        ) : null}
        <TextAreaField
          name="reason"
          label={t('platform.reason')}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error('reason')}
        />
        {overCapacity.length > 0 ? (
          <div
            data-testid="platform-over-capacity"
            className="rounded-lg border border-warning-border bg-warning-subtle p-3"
          >
            <p className="text-body font-medium text-text-primary">
              {t('platform.overCapacity.title')}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {overCapacity.map((entry) => (
                <li key={entry.kind} className="text-supporting text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {t(`platform.capacity.${entry.kind}`)}
                  </span>{' '}
                  {translateWithValues(messages, 'platform.overCapacity.entry', {
                    used: formatInteger(entry.used, locale),
                    limit: formatInteger(entry.newLimit, locale),
                  })}
                </li>
              ))}
            </ul>
            <p className={`mt-2 ${SECTION_HINT}`}>{t('platform.overCapacity.body')}</p>
            <div className="mt-3 flex flex-col gap-3">
              <CheckboxField
                name="acceptOverCapacity"
                label={t('platform.overCapacity.accept')}
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              {accepted ? (
                <TextAreaField
                  name="overCapacityReason"
                  label={t('platform.overCapacity.reason')}
                  required
                  value={acceptedReason}
                  onChange={(event) => setAcceptedReason(event.target.value)}
                  error={error('overCapacityReason')}
                />
              ) : null}
            </div>
          </div>
        ) : null}
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

function CancelDialog({
  messages,
  tenantId,
  subscription,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly subscription: OrganizationSubscription;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');
  const errors = action.state.fieldErrors ?? {};
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.subscription.act.cancel')}
      description={t('platform.subscription.cancelHint')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(
            () => cancelSubscriptionAction(tenantId, subscription.id, { effectiveTo, reason }),
            onClose
          );
        }}
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <TextField
          name="effectiveTo"
          type="date"
          label={t('platform.subscription.ends')}
          required
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
          error={error('effectiveTo')}
        />
        <TextAreaField
          name="reason"
          label={t('platform.reason')}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error('reason')}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            {t('overlay.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={action.pending}>
            {action.pending ? t('overlay.working') : t('platform.subscription.act.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
