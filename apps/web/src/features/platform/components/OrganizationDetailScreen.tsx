'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ReasonConfirmDialog } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDate, formatDateTime, formatInteger } from '@/lib/format';
import type { ReadState, CursorPage } from '@/lib/api/read-operation';
import { changeOrganizationStatusAction } from '../actions';
import {
  usageExceeds,
  usagePercent,
  usageWarns,
  type CapacityUsage,
  type OrganizationDetail,
  type SubscriptionCharge,
  type SubscriptionPlan,
} from '../types';
import { BillingPanel } from './BillingPanel';
import { OrganizationGrowthPanel } from './OrganizationGrowthPanel';
import { SubscriptionPanel, currentSubscription } from './SubscriptionPanel';
import { Cell, ReadFailure, SECONDARY_BUTTON, Section, SimpleTable, StatusBadge } from './ui';
import { useConsoleAction } from './use-console-action';

/**
 * One organisation, from the control plane (P1-32-PRE-066).
 *
 * Every action appears only for an operator whose platform authority could
 * satisfy it, and only where the lifecycle allows it. That is courtesy: the
 * server decides, and a refusal is shown as the server gave it.
 */

type LifecycleAct = 'suspend' | 'reactivate' | 'close';

const TARGET: Readonly<Record<LifecycleAct, 'active' | 'suspended' | 'closed'>> = {
  suspend: 'suspended',
  reactivate: 'active',
  close: 'closed',
};

/** The lifecycle acts legal from a status. `closed` is terminal. */
export function lifecycleActs(status: string): readonly LifecycleAct[] {
  if (status === 'active') return ['suspend', 'close'];
  if (status === 'suspended') return ['reactivate', 'close'];
  if (status === 'provisioning') return ['reactivate', 'close'];
  return [];
}

export interface DetailCapabilities {
  readonly canChangeLifecycle: boolean;
  /** `platform.organization.manage`: add a company or branch, invite an administrator. */
  readonly canManageOrganization: boolean;
  readonly canManageSubscription: boolean;
  readonly canReadBilling: boolean;
  readonly canManageBilling: boolean;
  readonly canReadAudit: boolean;
}

export function OrganizationDetailScreen({
  locale,
  messages,
  organization,
  plans,
  charges,
  chargeStatus = '',
  chargesPaged = false,
  capabilities,
  today,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly organization: OrganizationDetail;
  readonly plans: readonly SubscriptionPlan[] | null;
  readonly charges: ReadState<CursorPage<SubscriptionCharge>> | null;
  /** The charge status filter the address asked for, empty for every status. */
  readonly chargeStatus?: string;
  /** Whether the charge page came from a cursor rather than being the first. */
  readonly chargesPaged?: boolean;
  readonly capabilities: DetailCapabilities;
  readonly today: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [act, setAct] = useState<LifecycleAct | null>(null);
  const lifecycle = useConsoleAction(messages);
  const acts = capabilities.canChangeLifecycle ? lifecycleActs(organization.status) : [];
  const current = currentSubscription(organization.subscriptions, today);
  const currentPlan = plans?.find((plan) => plan.planCode === current?.planCode) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={organization.status} messages={messages} />
          <span dir="ltr" className="text-supporting text-text-secondary">
            {organization.tenantCode}
          </span>
          <span className="text-supporting text-text-muted">
            {t('platform.detail.created')} {formatDate(organization.createdAt, locale)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {acts.map((entry) => (
            <button
              key={entry}
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => {
                lifecycle.reset();
                setAct(entry);
              }}
            >
              {t(`platform.lifecycle.${entry}`)}
            </button>
          ))}
          {capabilities.canReadAudit ? (
            <Link
              href={`/${locale}/platform/audit?organization=${organization.id}`}
              className={SECONDARY_BUTTON}
            >
              {t('platform.detail.viewAudit')}
            </Link>
          ) : null}
        </div>
      </div>

      <Section title={t('platform.usage.title')}>
        <ul className="flex flex-col gap-3">
          {(['companies', 'branches', 'users'] as const).map((kind) => (
            <UsageBar
              key={kind}
              kind={kind}
              label={t(`platform.capacity.${kind}`)}
              usage={organization.capacity[kind]}
              messages={messages}
              locale={locale}
            />
          ))}
        </ul>
      </Section>

      <OrganizationGrowthPanel
        messages={messages}
        organization={organization}
        canManage={capabilities.canManageOrganization}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={t('platform.detail.companies')}>
          <SimpleTable
            caption={t('platform.detail.companies')}
            headers={[
              t('platform.provision.code'),
              t('platform.provision.legalName'),
              t('platform.subscription.status'),
            ]}
            empty={organization.companies.length === 0 ? t('platform.detail.noCompanies') : null}
          >
            {organization.companies.map((company) => (
              <tr key={company.id} className="border-t border-border-subtle">
                <Cell>
                  <span dir="ltr">{company.code}</span>
                </Cell>
                <Cell>{company.legalName}</Cell>
                <Cell>
                  <StatusBadge status={company.status} messages={messages} />
                </Cell>
              </tr>
            ))}
          </SimpleTable>
        </Section>
        <Section title={t('platform.detail.branches')}>
          <SimpleTable
            caption={t('platform.detail.branches')}
            headers={[
              t('platform.provision.code'),
              t('platform.provision.name'),
              t('platform.subscription.status'),
            ]}
            empty={organization.branches.length === 0 ? t('platform.detail.noBranches') : null}
          >
            {organization.branches.map((branch) => (
              <tr key={branch.id} className="border-t border-border-subtle">
                <Cell>
                  <span dir="ltr">{branch.code}</span>
                </Cell>
                <Cell>{branch.name}</Cell>
                <Cell>
                  <StatusBadge status={branch.status} messages={messages} />
                </Cell>
              </tr>
            ))}
          </SimpleTable>
        </Section>
      </div>

      <Section title={t('platform.detail.users')}>
        {organization.userCountsByStatus.length === 0 ? (
          <p className="text-body text-text-muted">{t('platform.detail.noUsers')}</p>
        ) : (
          <ul className="flex flex-wrap gap-4">
            {organization.userCountsByStatus.map((entry) => (
              <li key={entry.status} className="text-body text-text-primary">
                <StatusBadge status={entry.status} messages={messages} />{' '}
                <span className="tabular-nums">{formatInteger(entry.count, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <SubscriptionPanel
        locale={locale}
        messages={messages}
        organization={organization}
        plans={plans}
        canManage={capabilities.canManageSubscription}
        today={today}
      />

      {capabilities.canReadBilling && charges ? (
        charges.status === 'ok' ? (
          <BillingPanel
            locale={locale}
            messages={messages}
            tenantId={organization.id}
            charges={charges.data.items}
            hasMore={charges.data.hasMore}
            nextCursor={charges.data.nextCursor}
            status={chargeStatus}
            paged={chargesPaged}
            subscriptions={organization.subscriptions}
            canManage={capabilities.canManageBilling}
            defaultCurrency={currentPlan?.currencyCode ?? ''}
          />
        ) : (
          <Section title={t('platform.billing.title')}>
            <ReadFailure
              status={charges.status}
              correlationId={charges.correlationId}
              messages={messages}
            />
          </Section>
        )
      ) : null}

      <Section title={t('platform.detail.statusHistory')}>
        <SimpleTable
          caption={t('platform.detail.statusHistory')}
          headers={[
            t('platform.subscription.when'),
            t('platform.detail.from'),
            t('platform.detail.to'),
            t('platform.subscription.reason'),
          ]}
          empty={organization.statusHistory.length === 0 ? t('platform.detail.noHistory') : null}
        >
          {organization.statusHistory.map((entry, index) => (
            <tr key={`${entry.occurredAt}-${index}`} className="border-t border-border-subtle">
              <Cell>{formatDateTime(entry.occurredAt, locale)}</Cell>
              <Cell>
                {entry.fromState ? (
                  <StatusBadge status={entry.fromState} messages={messages} />
                ) : (
                  '—'
                )}
              </Cell>
              <Cell>
                <StatusBadge status={entry.toState} messages={messages} />
              </Cell>
              <Cell>{entry.reason ?? '—'}</Cell>
            </tr>
          ))}
        </SimpleTable>
      </Section>

      {act ? (
        <ReasonConfirmDialog
          open
          messages={messages}
          destructive={act !== 'reactivate'}
          pending={lifecycle.pending}
          title={t(`platform.lifecycle.${act}Title`)}
          description={t(`platform.lifecycle.${act}Body`)}
          confirmLabel={t(`platform.lifecycle.${act}`)}
          reasonLabel={t('platform.reason')}
          error={
            lifecycle.state.status !== 'idle' && lifecycle.state.status !== 'success'
              ? t(lifecycle.state.messageKey ?? 'action.failed')
              : undefined
          }
          onCancel={() => setAct(null)}
          onConfirm={(reason) => {
            const chosen = act;
            lifecycle.run(
              () => changeOrganizationStatusAction(organization.id, TARGET[chosen], reason),
              () => setAct(null)
            );
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Bar widths in five-percent steps, written out so the utility generator sees
 * every class literally. No inline style is used anywhere in the application.
 */
const BAR_WIDTH: readonly string[] = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
];

function UsageBar({
  kind,
  label,
  usage,
  messages,
  locale,
}: {
  readonly kind: string;
  readonly label: string;
  readonly usage: CapacityUsage;
  readonly messages: Messages;
  readonly locale: Locale;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const percent = usagePercent(usage);
  const warns = usageWarns(usage);
  // Above the ceiling, not merely near it. It happens when a plan below the
  // organisation's usage was assigned deliberately, and an operator shown only
  // "near the limit" would not know that nothing new can be added at all.
  const over = usageExceeds(usage);
  return (
    <li
      data-testid={`platform-usage-${kind}`}
      data-warning={warns ? 'true' : 'false'}
      data-over={over ? 'true' : 'false'}
      className="flex flex-col gap-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-supporting">
        <span className="text-text-primary">{label}</span>
        <span className="tabular-nums text-text-secondary">
          {usage.limit === null
            ? `${formatInteger(usage.used, locale)} · ${t('platform.usage.unlimited')}`
            : `${formatInteger(usage.used, locale)} / ${formatInteger(usage.limit, locale)}`}
          {over ? (
            <span className="ms-2 font-medium text-error">{t('platform.usage.over')}</span>
          ) : warns ? (
            <span className="ms-2 font-medium text-warning">{t('platform.usage.warning')}</span>
          ) : null}
        </span>
      </div>
      {percent === null ? null : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={usage.limit ?? 0}
          aria-valuenow={Math.min(usage.used, usage.limit ?? usage.used)}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-subtle"
        >
          <div
            data-percent={percent}
            className={`h-full rounded-full ${BAR_WIDTH[Math.round(percent / 5)] ?? 'w-full'} ${
              over ? 'bg-error' : warns ? 'bg-warning' : 'bg-primary'
            }`}
          />
        </div>
      )}
    </li>
  );
}
