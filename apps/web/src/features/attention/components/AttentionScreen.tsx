'use client';

import { useCallback, useMemo, useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
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
  initialBranchId = null,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * The branch the address asked the stock cards to open on, already checked
   * for the shape of an identifier by the page. Believed only if the picker's
   * own list holds it; otherwise the screen opens with no branch chosen.
   */
  readonly initialBranchId?: string | null;
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

  /*
   * The address's branch, applied ONCE — when the list it must belong to has
   * arrived — and never again, so a later choice from the picker is not
   * overwritten by a branch from an address the reader has since moved on from.
   *
   * Decided during render rather than in an effect: it is state derived from a
   * prop and a list, and adjusting it here settles in the same render instead
   * of painting "choose a branch" for a frame and then cascading. A branch the
   * list does not hold is dropped, not guessed at.
   */
  const [preselected, setPreselected] = useState(initialBranchId === null);
  if (!preselected && branches.phase === 'listed') {
    setPreselected(true);
    const chosen = branches.items.find((row) => row.id === initialBranchId);
    if (chosen !== undefined) setPair({ companyId: chosen.companyId, branchId: chosen.id });
  }

  /*
   * The working branch, followed (route sweep B3). The stock cards used to wait
   * on "choose a branch" while the header already named one. With no branch in
   * the address they now open on the working branch, and every later change of
   * the working branch moves them to the new one — decided during render, like
   * the address above, once per working-context version. An address that named
   * a branch wins on arrival only. "All my branches" and "not chosen yet" leave
   * the picker as it is: every stock alert is addressed to one branch.
   */
  const context = useWorkingContext();
  const [followed, setFollowed] = useState<number | null>(() =>
    initialBranchId === null ? null : context.version
  );
  if (followed !== context.version && preselected && branches.phase === 'listed') {
    setFollowed(context.version);
    const selection = context.selection;
    const working =
      selection !== null && !selection.allBranches
        ? branches.items.find((row) => row.id === selection.branchId)
        : undefined;
    if (working !== undefined) setPair({ companyId: working.companyId, branchId: working.id });
  }

  /*
   * The branch list, as a lookup for the cards that report on a PAIR of
   * branches. A transfer names the two it runs between by identifier only, and
   * the only place on this screen that already knows their names is the list
   * the picker was given. A branch missing from it stays missing: the card says
   * so rather than inventing a name or quietly showing something else.
   */
  const names = useMemo(() => {
    const map = new Map<string, string>();
    if (branches.phase === 'listed') for (const row of branches.items) map.set(row.id, row.name);
    return map;
  }, [branches]);
  const branchName = useCallback((id: string) => names.get(id) ?? null, [names]);

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
              branchName={branchName}
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
