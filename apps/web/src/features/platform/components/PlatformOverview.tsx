import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime, formatInteger, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { PlatformStatistics } from '../types';
import { Section, SimpleTable, Cell } from './ui';

/**
 * How one capacity severity is drawn and what it is called.
 *
 * Three states arrive from the console read — `near-limit`, `at-limit` and
 * `over-limit` — and they are ordered. An organisation PAST its ceiling is the
 * most severe of the three, so it is drawn like the one sitting exactly on it
 * and never like the near band: a ternary that treated "not at-limit" as "close
 * to the limit" would draw the worst state in the mildest colour and call it
 * "Close to the limit", which is the opposite of what happened.
 *
 * A severity this console does not recognise keeps the alert visible and its
 * numbers readable, but is given no severity word at all. Naming it as the
 * mildest state is exactly the failure this map exists to prevent.
 */
const CAPACITY_SEVERITY = new Map<string, { readonly tone: string; readonly label: string }>([
  [
    'over-limit',
    { tone: 'border-error-border bg-error-subtle', label: 'platform.capacity.overLimit' },
  ],
  ['at-limit', { tone: 'border-error-border bg-error-subtle', label: 'platform.capacity.atLimit' }],
  [
    'near-limit',
    { tone: 'border-warning-border bg-warning-subtle', label: 'platform.capacity.nearLimit' },
  ],
]);

/** The frame of an alert whose severity the console cannot name. */
const CAPACITY_SEVERITY_UNKNOWN_TONE = 'border-warning-border bg-warning-subtle';

/**
 * The console overview (P1-32-PRE-065).
 *
 * The revenue figures are four DIFFERENT things and each is labelled as what it
 * is: contracted, received and outstanding are recorded amounts; the projected
 * renewal value is a planning figure and is never presented as money owed.
 * Amounts arrive as decimal strings and are only formatted for reading.
 */
export function PlatformOverview({
  locale,
  messages,
  statistics,
  canReadOrganizations,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly statistics: PlatformStatistics;
  readonly canReadOrganizations: boolean;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const count = (status: string) =>
    statistics.tenantsByStatus.find((entry) => entry.key === status)?.count ?? 0;
  const number = (value: number | null) =>
    value === null
      ? translate(messages, 'platform.overview.notAvailable')
      : formatInteger(value, locale);
  const money = (amount: string, currency: string) =>
    formatMoney({ amount, currency }, intlLocale(locale));

  const tiles: readonly { key: string; label: string; value: number }[] = [
    { key: 'active', label: t('platform.overview.activeOrganizations'), value: count('active') },
    {
      key: 'suspended',
      label: t('platform.overview.suspendedOrganizations'),
      value: count('suspended'),
    },
    {
      key: 'expiring30',
      label: t('platform.overview.expiring30'),
      value: statistics.subscriptions.expiringWithin30Days,
    },
    {
      key: 'expiring60',
      label: t('platform.overview.expiring60'),
      value: statistics.subscriptions.expiringWithin60Days,
    },
    {
      key: 'expiring90',
      label: t('platform.overview.expiring90'),
      value: statistics.subscriptions.expiringWithin90Days,
    },
    {
      key: 'companies',
      label: t('platform.overview.companies'),
      value: statistics.activeCompanies,
    },
    { key: 'branches', label: t('platform.overview.branches'), value: statistics.activeBranches },
    { key: 'users', label: t('platform.overview.users'), value: statistics.activeUserAccounts },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p data-testid="platform-freshness" className="text-supporting text-text-muted">
        {t('platform.overview.generatedAt')} {formatDateTime(statistics.generatedAt, locale)}
      </p>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <li
            key={tile.key}
            data-testid={`platform-tile-${tile.key}`}
            className="rounded-xl border border-border-subtle bg-surface p-4"
          >
            <p className="text-supporting text-text-secondary">{tile.label}</p>
            <p className="mt-1 text-page-title font-semibold tabular-nums text-text-primary">
              {formatInteger(tile.value, locale)}
            </p>
          </li>
        ))}
      </ul>

      <Section title={t('platform.overview.revenue')}>
        <p className="mb-3 text-supporting text-text-muted">
          {t('platform.overview.projectionNote')}
        </p>
        <SimpleTable
          caption={t('platform.overview.revenue')}
          headers={[
            t('platform.overview.currency'),
            t('platform.overview.contracted'),
            t('platform.overview.received'),
            t('platform.overview.outstanding'),
            t('platform.overview.projectedRenewal'),
          ]}
          empty={
            statistics.revenueByCurrency.length === 0 ? t('platform.overview.noRevenue') : null
          }
        >
          {statistics.revenueByCurrency.map((row) => (
            <tr key={row.currencyCode} className="border-t border-border-subtle">
              <Cell>{row.currencyCode}</Cell>
              <Cell end>{money(row.contracted, row.currencyCode)}</Cell>
              <Cell end>{money(row.received, row.currencyCode)}</Cell>
              <Cell end>{money(row.outstanding, row.currencyCode)}</Cell>
              <Cell end>
                <span data-testid="platform-projection">
                  {money(row.projectedRenewalValue, row.currencyCode)}
                </span>
              </Cell>
            </tr>
          ))}
        </SimpleTable>
      </Section>

      <Section title={t('platform.overview.capacityAlerts')}>
        {statistics.capacityAlerts.length === 0 ? (
          <p className="text-body text-text-muted">{t('platform.overview.noCapacityAlerts')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {statistics.capacityAlerts.map((alert) => {
              const presentation = CAPACITY_SEVERITY.get(alert.severity);
              return (
                <li
                  key={`${alert.tenantId}-${alert.kind}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    presentation?.tone ?? CAPACITY_SEVERITY_UNKNOWN_TONE
                  }`}
                >
                  {canReadOrganizations ? (
                    <Link
                      href={`/${locale}/platform/organizations/${alert.tenantId}`}
                      className="font-medium text-text-primary underline"
                    >
                      {alert.displayName}
                    </Link>
                  ) : (
                    <span className="font-medium text-text-primary">{alert.displayName}</span>
                  )}
                  <span className="text-supporting text-text-secondary">
                    {t(
                      `platform.capacity.${['companies', 'branches', 'users'].includes(alert.kind) ? alert.kind : 'other'}`
                    )}
                    {': '}
                    {formatInteger(alert.used, locale)} / {formatInteger(alert.limit, locale)}
                    {presentation ? `${' · '}${t(presentation.label)}` : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t('platform.overview.health')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.overview.readiness')}
            </dt>
            <dd
              data-testid="platform-readiness"
              className="text-body font-medium text-text-primary"
            >
              {t(
                ['ready', 'degraded', 'unavailable'].includes(statistics.health.readiness)
                  ? `platform.readiness.${statistics.health.readiness}`
                  : 'platform.readiness.unavailable'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-supporting text-text-secondary">
              {t('platform.overview.undelivered')}
            </dt>
            <dd className="text-body font-medium tabular-nums text-text-primary">
              {statistics.health.outbox.reachable
                ? number(statistics.health.outbox.undelivered)
                : t('platform.overview.notAvailable')}
            </dd>
          </div>
          <div>
            <dt className="text-supporting text-text-secondary">{t('platform.overview.failed')}</dt>
            <dd className="text-body font-medium tabular-nums text-text-primary">
              {statistics.health.outbox.reachable
                ? number(statistics.health.outbox.deadLettered)
                : t('platform.overview.notAvailable')}
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
