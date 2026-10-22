'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
} from '@/components/data/OperationalGrid';
import { MuiEmptyState, MuiReadFailureState } from '@/components/states/MuiStates';
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
  type OrganizationBranch,
  type OrganizationCompany,
  type OrganizationDetail,
  type ReferenceValues,
  type StatusHistoryEntry,
  type SubscriptionCharge,
  type SubscriptionPlan,
} from '../types';
import { BillingPanel } from './BillingPanel';
import { ConsoleReasonDialog, ConsoleSection, useSettledTable } from './console-parts';
import { OrganizationGrowthPanel } from './OrganizationGrowthPanel';
import { SubscriptionPanel, currentSubscription } from './SubscriptionPanel';
import { StatusBadge } from './ui';
import { useConsoleAction } from './use-console-action';

/**
 * One organisation, from the control plane (P1-32-PRE-066).
 *
 * Every action appears only for an operator whose platform authority could
 * satisfy it, and only where the lifecycle allows it. That is courtesy: the
 * server decides, and a refusal is shown as the server gave it.
 *
 * ## On Material UI (ADR-022, P1-32-PRE-OD-WP06B)
 *
 * The companies, the branches and the status history are the operational grid
 * over the rows the detail read already holds: one answer, so no pager. A code
 * is drawn whole in its own line cell, ending in an ellipsis with its whole text
 * behind it when the column is narrower; a company and a branch are named by the
 * names the read carries, beside their codes. A reason in the history is free
 * text and keeps to one line in the same way.
 *
 * The lifecycle acts are Material buttons, and the reason they ask for is the
 * console's reason dialog (`ConsoleReasonDialog`). The usage meters are unchanged
 * in what they say: "Unlimited" where the plan sets no limit, the count against
 * the limit otherwise, "Near the limit" from 90% and "Over the limit" above it.
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

/** A status-history entry with the key it is drawn under: the read gives none. */
interface HistoryRow extends StatusHistoryEntry {
  readonly key: string;
}

/** A code, left to right, whole: the grid line cuts it only with an ellipsis. */
function codeLine(code: string, testId?: string) {
  return (
    <TwoLineCell
      primary={
        <code dir="ltr" className="font-mono">
          {code}
        </code>
      }
      testId={testId}
    />
  );
}

export function OrganizationDetailScreen({
  locale,
  messages,
  organization,
  plans,
  referenceValues = null,
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
  /**
   * The currencies and time zones the growth dialogs offer
   * (`platform.reference-values-read`). `null`, or absent, means they could not
   * be read, and those two selects are shown disabled with a notice.
   */
  readonly referenceValues?: ReferenceValues | null;
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

  const history = useMemo<readonly HistoryRow[]>(
    () =>
      organization.statusHistory.map((entry, index) => ({
        ...entry,
        key: `${entry.occurredAt}-${index}`,
      })),
    [organization.statusHistory]
  );
  const companiesTable = useSettledTable(organization.companies);
  const branchesTable = useSettledTable(organization.branches);
  const historyTable = useSettledTable(history);

  const companyColumns = useMemo<readonly OperationalColumn<OrganizationCompany>[]>(
    () => [
      {
        id: 'code',
        headerKey: 'platform.provision.code',
        cell: (company) => codeLine(company.code, 'platform-company-code'),
      },
      {
        id: 'name',
        headerKey: 'platform.provision.legalName',
        flex: 2,
        cell: (company) => <TwoLineCell primary={<bdi>{company.legalName}</bdi>} />,
      },
      {
        id: 'status',
        headerKey: 'platform.subscription.status',
        cell: (company) => <StatusBadge status={company.status} messages={messages} />,
      },
    ],
    [messages]
  );

  const branchColumns = useMemo<readonly OperationalColumn<OrganizationBranch>[]>(
    () => [
      {
        id: 'code',
        headerKey: 'platform.provision.code',
        cell: (branch) => codeLine(branch.code, 'platform-branch-code'),
      },
      {
        id: 'name',
        headerKey: 'platform.provision.name',
        flex: 2,
        cell: (branch) => <TwoLineCell primary={<bdi>{branch.name}</bdi>} />,
      },
      {
        id: 'status',
        headerKey: 'platform.subscription.status',
        cell: (branch) => <StatusBadge status={branch.status} messages={messages} />,
      },
    ],
    [messages]
  );

  const historyColumns = useMemo<readonly OperationalColumn<HistoryRow>[]>(
    () => [
      {
        id: 'when',
        headerKey: 'platform.subscription.when',
        minChars: 24,
        cell: (entry) => formatDateTime(entry.occurredAt, locale),
      },
      {
        id: 'from',
        headerKey: 'platform.detail.from',
        cell: (entry) =>
          entry.fromState ? <StatusBadge status={entry.fromState} messages={messages} /> : '—',
      },
      {
        id: 'to',
        headerKey: 'platform.detail.to',
        cell: (entry) => <StatusBadge status={entry.toState} messages={messages} />,
      },
      {
        id: 'reason',
        headerKey: 'platform.subscription.reason',
        flex: 2,
        cell: (entry) =>
          entry.reason ? (
            <TwoLineCell primary={<bdi>{entry.reason}</bdi>} testId="platform-history-reason" />
          ) : (
            '—'
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
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
            <Button
              key={entry}
              type="button"
              variant="outlined"
              onClick={() => {
                lifecycle.reset();
                setAct(entry);
              }}
            >
              {t(`platform.lifecycle.${entry}`)}
            </Button>
          ))}
          {capabilities.canReadAudit ? (
            <Button
              component={Link}
              href={`/${locale}/platform/audit?organization=${organization.id}`}
              variant="outlined"
            >
              {t('platform.detail.viewAudit')}
            </Button>
          ) : null}
        </div>
      </div>

      <ConsoleSection title={t('platform.usage.title')}>
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
      </ConsoleSection>

      <OrganizationGrowthPanel
        locale={locale}
        messages={messages}
        organization={organization}
        canManage={capabilities.canManageOrganization}
        referenceValues={referenceValues}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ConsoleSection title={t('platform.detail.companies')}>
          <OperationalGrid<OrganizationCompany>
            messages={messages}
            // No locale on any of this page's grids, as on the console lists: an
            // ended session offers no link to bare sign-in. These hold the one
            // detail read and never report one; the page's own session check
            // sends an ended session to the session-ended route.
            label={t('platform.detail.companies')}
            columns={companyColumns}
            rowId={(company) => company.id}
            table={companiesTable}
            // The detail's own sentence when there is none, below.
            suppressEmptyState
            // Every company, in the one detail read: no pager to offer.
            unpaged
            testId="platform-companies-grid"
          />
          {organization.companies.length === 0 ? (
            <MuiEmptyState
              messages={messages}
              descriptionKey="platform.detail.noCompanies"
              testId="platform-companies-empty"
            />
          ) : null}
        </ConsoleSection>
        <ConsoleSection title={t('platform.detail.branches')}>
          <OperationalGrid<OrganizationBranch>
            messages={messages}
            label={t('platform.detail.branches')}
            columns={branchColumns}
            rowId={(branch) => branch.id}
            table={branchesTable}
            suppressEmptyState
            unpaged
            testId="platform-branches-grid"
          />
          {organization.branches.length === 0 ? (
            <MuiEmptyState
              messages={messages}
              descriptionKey="platform.detail.noBranches"
              testId="platform-branches-empty"
            />
          ) : null}
        </ConsoleSection>
      </div>

      <ConsoleSection title={t('platform.detail.users')}>
        {organization.userCountsByStatus.length === 0 ? (
          <p className="text-body text-text-muted" data-testid="platform-users-empty">
            {t('platform.detail.noUsers')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-4" data-testid="platform-user-counts">
            {organization.userCountsByStatus.map((entry) => (
              <li key={entry.status} className="text-body text-text-primary">
                <StatusBadge status={entry.status} messages={messages} />{' '}
                <span className="tabular-nums">{formatInteger(entry.count, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </ConsoleSection>

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
          <ConsoleSection title={t('platform.billing.title')}>
            {/*
              The read was refused or failed: said as that, never as an
              organisation with no charges. No retry is offered, as before —
              the page is read on the server, and a reload repeats it.

              No locale is passed, so an ended session offers no link, as the
              state it replaces offered none: with one, the state would link to
              bare sign-in, where the console's own session check sends an ended
              session to the session-ended route with the page it was on.
            */}
            <MuiReadFailureState
              messages={messages}
              status={charges.status}
              correlationId={charges.correlationId}
            />
          </ConsoleSection>
        )
      ) : null}

      <ConsoleSection title={t('platform.detail.statusHistory')}>
        <OperationalGrid<HistoryRow>
          messages={messages}
          label={t('platform.detail.statusHistory')}
          columns={historyColumns}
          rowId={(entry) => entry.key}
          table={historyTable}
          suppressEmptyState
          unpaged
          testId="platform-history-grid"
        />
        {organization.statusHistory.length === 0 ? (
          <MuiEmptyState
            messages={messages}
            descriptionKey="platform.detail.noHistory"
            testId="platform-history-empty"
          />
        ) : null}
      </ConsoleSection>

      {act ? (
        <ConsoleReasonDialog
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
          testId="platform-lifecycle-dialog"
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
