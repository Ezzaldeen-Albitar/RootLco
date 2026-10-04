import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';
import {
  capacityPercent,
  isCapacityNear,
  type CapacityAllowance,
  type CapacityKind,
  type CapacityView,
} from '../types';

/**
 * "Subscription and capacity".
 *
 * What the organisation may hold, what it holds, and the plan that decides it.
 * The numbers are the ones `org.capacity_usage` computes — the same function the
 * refusal is decided by — so the panel and a refused creation cannot disagree.
 *
 * The remedy for a full allowance is a plan change made by the platform owner,
 * so the panel says that rather than offering a control that could not help.
 */

const KINDS: readonly CapacityKind[] = ['companies', 'branches', 'users'];

export function CapacityPanel({
  capacity,
  messages,
  locale,
}: {
  readonly capacity: CapacityView;
  readonly messages: Messages;
  readonly locale: Locale;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const plan = capacity.subscription;

  return (
    <div className="flex flex-col gap-4">
      {plan ? (
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <dt className="text-label font-medium text-text-primary">
              {t('organization.capacity.plan')}
            </dt>
            <dd className="text-body text-text-secondary">{plan.displayName}</dd>
          </div>
          <div>
            <dt className="text-label font-medium text-text-primary">
              {t('organization.capacity.from')}
            </dt>
            <dd className="text-body text-text-secondary">
              {formatDate(plan.effectiveFrom, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-label font-medium text-text-primary">
              {t('organization.capacity.until')}
            </dt>
            <dd className="text-body text-text-secondary">
              {plan.effectiveTo
                ? formatDate(plan.effectiveTo, locale)
                : t('organization.capacity.noEndDate')}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-supporting text-text-secondary">{t('organization.capacity.noPlan')}</p>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {KINDS.map((kind) => (
          <AllowanceRow
            key={kind}
            kind={kind}
            allowance={capacity.capacity[kind]}
            messages={messages}
          />
        ))}
      </ul>
    </div>
  );
}

function AllowanceRow({
  kind,
  allowance,
  messages,
}: {
  readonly kind: CapacityKind;
  readonly allowance: CapacityAllowance | undefined;
  readonly messages: Messages;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const label = t(`organization.capacity.kind.${kind}`);
  if (allowance === undefined) return null;

  const percent = capacityPercent(allowance);
  const near = isCapacityNear(allowance);
  const summary =
    allowance.limit === null
      ? formatMessage(t('organization.capacity.usedUnlimited'), { used: String(allowance.used) })
      : formatMessage(t('organization.capacity.usedOf'), {
          used: String(allowance.used),
          limit: String(allowance.limit),
        });

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        near ? 'border-warning-border bg-warning-subtle' : 'border-border-subtle bg-surface'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <span className="text-supporting text-text-secondary">{summary}</span>
      </div>
      {percent === null ? (
        <span className="text-caption text-text-muted">{t('organization.capacity.unlimited')}</span>
      ) : (
        <progress
          max={100}
          value={percent}
          aria-label={`${label}: ${summary}`}
          className={`h-2 w-full ${near ? 'accent-warning' : 'accent-primary'}`}
        />
      )}
      {near && percent !== null ? (
        <span className="text-caption text-text-primary">
          {t(percent >= 100 ? 'organization.capacity.full' : 'organization.capacity.nearlyFull')}
        </span>
      ) : null}
    </li>
  );
}
