'use client';

import { useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  useBranches,
  type BranchPair,
} from '@/features/inventory/components/shared';

import {
  AgedInTransitCard,
  CapacityCard,
  CountDiscrepancyCard,
  LowStockCard,
  UnusualConsumptionCard,
} from './cards';

/**
 * The Attention area (Owner directive, operational alerts).
 *
 * What is about to stop working, in one place, each finding beside the evidence
 * it was decided from and each row linking to the screen where something can be
 * done about it.
 *
 * ## Four cards are about a BRANCH, and one is about the organisation
 *
 * The stock alerts are branch-targeted reads: the pair is the read's target and
 * is re-authorized server-side on every call, so nothing about stock is asked
 * for until a branch is named — and until then those cards say so rather than
 * showing an empty table. The subscription allowance is tenant-wide and has no
 * target, so it reads on first paint.
 *
 * ## Nothing on this screen writes
 *
 * There is no form and no submit. Every card calls a read, and the only figure
 * that resembles an instruction — a preferred order quantity — is labelled as a
 * suggestion where it is drawn. A suggestion is not a transaction: nothing here
 * posts stock, orders anything or moves money.
 *
 * ## A missing permission is said, not drawn as emptiness
 *
 * A session without `inv.stock.read` is told the stock signals are not theirs to
 * see. Rendering four empty cards instead would read as "the branch is fine",
 * which is a claim about stock that nobody made.
 */
export function AttentionScreen({
  locale,
  messages,
  canReadStock,
  canReadCapacity,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.read` — the four stock alerts. */
  readonly canReadStock: boolean;
  /** `org.tenant.read` — the subscription allowance. */
  readonly canReadCapacity: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const branches = useBranches(canReadBranches && canReadStock);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const t = (key: keyof Messages) => translate(messages, key);

  return (
    <div className="flex flex-col gap-4">
      {canReadStock ? (
        <section className="rounded-xl border border-border-subtle bg-surface p-4">
          <h2 className="text-section-title font-semibold text-text-primary">
            {t('attention.target.heading')}
          </h2>
          <p className="mt-1 text-supporting text-text-secondary">
            {t('attention.target.explain')}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <BranchPairPicker
              messages={messages}
              branches={branches}
              label={t('attention.target.branch')}
              placeholder={t('attention.target.choose')}
              value={pair}
              onChange={setPair}
            />
          </div>
        </section>
      ) : (
        <p className="rounded-xl border border-border-subtle bg-surface p-4 text-body text-text-muted">
          {t('attention.state.stockDenied')}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {canReadStock ? (
          /*
           * Keyed on the PAIR, so choosing another branch remounts every card
           * rather than leaving one branch's findings on screen while the next
           * branch is being read. It is also what lets each card derive "in
           * flight" instead of assigning it.
           */
          <div key={`${pair.companyId}:${pair.branchId}`} className="flex flex-col gap-4">
            <LowStockCard
              messages={messages}
              locale={locale}
              companyId={pair.companyId}
              branchId={pair.branchId}
            />
            <CountDiscrepancyCard
              messages={messages}
              locale={locale}
              companyId={pair.companyId}
              branchId={pair.branchId}
            />
            <UnusualConsumptionCard
              messages={messages}
              locale={locale}
              companyId={pair.companyId}
              branchId={pair.branchId}
            />
            <AgedInTransitCard
              messages={messages}
              locale={locale}
              companyId={pair.companyId}
              branchId={pair.branchId}
            />
          </div>
        ) : null}

        {canReadCapacity ? (
          <CapacityCard messages={messages} locale={locale} enabled />
        ) : (
          <p className="rounded-xl border border-border-subtle bg-surface p-4 text-body text-text-muted">
            {t('attention.state.capacityDenied')}
          </p>
        )}
      </div>
    </div>
  );
}
