'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { ZonedDateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { MuiFormFeedback } from '@/features/authentication/components/MuiFormFeedback';
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
import { ConsoleSection, ConsoleTable, useUnfinishedDays } from './console-parts';
import { SECTION_HINT, StatusBadge } from './ui';
import { useConsoleAction } from './use-console-action';
import { useStateRefusal } from '@/lib/forms/use-local-refusal';

/**
 * The subscription panel of an organisation (P1-32-PRE-066).
 *
 * Assign, renew, upgrade and downgrade are four acts on the same two rows, and
 * the backend records which one was meant — so each is its own button and the
 * dialog sends the act as `kind`. The term is a whole number of months: a preset
 * or a free value.
 *
 * ## On Material UI (ADR-022, P1-32-PRE-OD-WP06B2)
 *
 * Presentation only. The acts offered, the plans the assign dialog offers (the
 * active ones, in the catalogue's order, by name), the term choices, the
 * over-capacity confirmation and the documents the two dialogs send are exactly
 * what they were; so is every sentence the panel says, "This organisation has no
 * subscription" among them. The history and the changes are Material tables, so
 * a long plan name or reason wraps rather than being cut. The two forms are the
 * shared form dialog with the Material fields.
 *
 * The start day and the last day are day pickers on UTC, the clock the console's
 * other days are read on: the console has no working branch to take another
 * from. A day only partly typed, or one that is not a day, holds no day; sent as
 * it stood it would have reached the server as an empty date, so the form
 * refuses it on its own box before anything is sent. A blank box is sent as it
 * was before.
 */

type Pending =
  | { readonly type: 'assign'; readonly kind: AssignmentKind }
  | { readonly type: 'cancel'; readonly subscription: OrganizationSubscription };

/** The clock the two day pickers are drawn on. See the note above. */
const SUBSCRIPTION_DAY_ZONE = 'UTC';

const EVENT_KINDS = [
  'assigned',
  'renewed',
  'upgraded',
  'downgraded',
  'cancelled',
  'suspended',
  'reactivated',
];

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
          <Button
            key={kind}
            type="button"
            variant="outlined"
            onClick={() => setPending({ type: 'assign', kind })}
          >
            {t(`platform.subscription.act.${kind}`)}
          </Button>
        ))}
        <Button
          type="button"
          variant="outlined"
          onClick={() => setPending({ type: 'cancel', subscription: current })}
        >
          {t('platform.subscription.act.cancel')}
        </Button>
      </>
    ) : (
      <Button
        type="button"
        variant="outlined"
        onClick={() => setPending({ type: 'assign', kind: 'assigned' })}
      >
        {t('platform.subscription.act.assigned')}
      </Button>
    )
  ) : null;

  return (
    <ConsoleSection title={t('platform.subscription.title')} actions={actions}>
      {current ? (
        <dl data-testid="platform-current-plan" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.subscription.plan')}
            </dt>
            <dd className="break-words text-body font-medium text-text-primary">
              <bdi>{current.planName}</bdi>
            </dd>
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
        <p data-testid="platform-no-subscription" className="text-body text-text-muted">
          {t('platform.subscription.none')}
        </p>
      )}

      <h3 className="mt-1 text-label font-semibold text-text-secondary">
        {t('platform.subscription.history')}
      </h3>
      <ConsoleTable
        caption={t('platform.subscription.history')}
        headers={[
          { label: t('platform.subscription.plan') },
          { label: t('platform.subscription.status') },
          { label: t('platform.subscription.starts') },
          { label: t('platform.subscription.ends') },
        ]}
        empty={organization.subscriptions.length === 0 ? t('platform.subscription.none') : null}
        testId="platform-subscription-history"
      >
        {organization.subscriptions.map((entry) => (
          <TableRow key={entry.id} className="align-top">
            <TableCell className="break-words">
              <bdi>{entry.planName}</bdi>
            </TableCell>
            <TableCell>
              <StatusBadge status={entry.status} messages={messages} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDate(entry.effectiveFrom, locale)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {entry.effectiveTo
                ? formatDate(entry.effectiveTo, locale)
                : t('platform.subscription.openEnded')}
            </TableCell>
          </TableRow>
        ))}
      </ConsoleTable>

      <h3 className="mt-1 text-label font-semibold text-text-secondary">
        {t('platform.subscription.events')}
      </h3>
      <ConsoleTable
        caption={t('platform.subscription.events')}
        headers={[
          { label: t('platform.subscription.when') },
          { label: t('platform.subscription.act') },
          { label: t('platform.subscription.change') },
          { label: t('platform.subscription.reason') },
        ]}
        empty={
          organization.subscriptionEvents.length === 0 ? t('platform.subscription.noEvents') : null
        }
        testId="platform-subscription-events"
      >
        {organization.subscriptionEvents.map((event) => (
          <TableRow key={event.id} className="align-top">
            <TableCell className="whitespace-nowrap">
              {formatDateTime(event.occurredAt, locale)}
            </TableCell>
            <TableCell>
              {t(
                `platform.subscription.event.${EVENT_KINDS.includes(event.eventKind) ? event.eventKind : 'other'}`
              )}
            </TableCell>
            <TableCell className="break-words">
              <span dir="ltr">
                {[event.fromPlanCode, event.toPlanCode].filter(Boolean).join(' → ') || '—'}
              </span>
            </TableCell>
            <TableCell className="break-words">
              <bdi>{event.reason}</bdi>
            </TableCell>
          </TableRow>
        ))}
      </ConsoleTable>

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
    </ConsoleSection>
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
  const [fromProblem, setFromProblem] = useState<DayProblem>(null);
  const [preset, setPreset] = useState<string>('12');
  const [customTerm, setCustomTerm] = useState('');
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [acceptedReason, setAcceptedReason] = useState('');
  const { refusal, refuse } = useUnfinishedDays(action.state);
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3). A day box changes when its
  // day does or when what the picker finds wrong with it does.
  const { errors, formRef } = useStateRefusal(refusal, {
    planCode,
    effectiveFrom: `${effectiveFrom}#${fromProblem ?? ''}`,
    preset,
    customTerm,
    reason,
    acceptedReason,
  });
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
    if (refuse({ effectiveFrom: fromProblem })) return;
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
    <FormDialog
      messages={messages}
      title={t(`platform.subscription.act.${kind}`)}
      description={t('platform.subscription.dialogHint')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={submit}
      formRef={formRef}
      testId="platform-assign-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormSelectField
        name="planCode"
        label={t('platform.subscription.plan')}
        required
        value={planCode}
        placeholder={t('platform.provision.choose')}
        onChange={setPlanCode}
        options={active.map((plan) => ({
          value: plan.planCode,
          label: plan.displayName ?? plan.name,
        }))}
        error={error('planCode')}
      />
      <ZonedDateField
        name="effectiveFrom"
        timezone={SUBSCRIPTION_DAY_ZONE}
        label={t('platform.subscription.starts')}
        required
        value={effectiveFrom}
        onChange={setEffectiveFrom}
        onProblem={setFromProblem}
        error={error('effectiveFrom')}
        testId="platform-assign-starts"
      />
      <FormSelectField
        name="termPreset"
        label={t('platform.subscription.term')}
        value={preset}
        onChange={setPreset}
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
        <FormTextField
          name="termMonths"
          inputMode="numeric"
          dir="ltr"
          label={t('platform.subscription.termMonths')}
          required
          value={customTerm}
          onChange={setCustomTerm}
          error={error('termMonths')}
        />
      ) : null}
      <FormTextField
        name="reason"
        multiline
        rows={3}
        label={t('platform.reason')}
        required
        value={reason}
        onChange={setReason}
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
            <FormCheckboxField
              name="acceptOverCapacity"
              label={t('platform.overCapacity.accept')}
              checked={accepted}
              onChange={setAccepted}
            />
            {accepted ? (
              <FormTextField
                name="overCapacityReason"
                multiline
                rows={3}
                label={t('platform.overCapacity.reason')}
                required
                value={acceptedReason}
                onChange={setAcceptedReason}
                error={error('overCapacityReason')}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </FormDialog>
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
  const [toProblem, setToProblem] = useState<DayProblem>(null);
  const [reason, setReason] = useState('');
  const { refusal, refuse } = useUnfinishedDays(action.state);
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(refusal, {
    effectiveTo: `${effectiveTo}#${toProblem ?? ''}`,
    reason,
  });
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    <FormDialog
      messages={messages}
      title={t('platform.subscription.act.cancel')}
      description={t('platform.subscription.cancelHint')}
      submitLabel={t('platform.subscription.act.cancel')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={() => {
        if (refuse({ effectiveTo: toProblem })) return;
        action.run(
          () => cancelSubscriptionAction(tenantId, subscription.id, { effectiveTo, reason }),
          onClose
        );
      }}
      formRef={formRef}
      testId="platform-cancel-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <ZonedDateField
        name="effectiveTo"
        timezone={SUBSCRIPTION_DAY_ZONE}
        label={t('platform.subscription.ends')}
        required
        value={effectiveTo}
        onChange={setEffectiveTo}
        onProblem={setToProblem}
        error={error('effectiveTo')}
        testId="platform-cancel-ends"
      />
      <FormTextField
        name="reason"
        multiline
        rows={3}
        label={t('platform.reason')}
        required
        value={reason}
        onChange={setReason}
        error={error('reason')}
      />
    </FormDialog>
  );
}
