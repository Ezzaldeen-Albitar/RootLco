'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDateTime, formatInteger } from '@/lib/format';
import {
  readAgedInTransitAlerts,
  readCountDiscrepancyAlerts,
  readLowStockAlerts,
  readUnusualConsumptionAlerts,
} from '@/features/inventory/api';
import { readCapacityAlerts } from '../api';
import {
  CAPACITY_KINDS,
  attentionLink,
  refusalKey,
  type CapacityAlerts,
} from '../attention-contract';

/**
 * The five cards of the Attention area.
 *
 * Each one reads for itself. A card that shares a read with its neighbour makes
 * one refusal silence two findings, and the operator is then told nothing about
 * a thing nobody refused them.
 *
 * ## Four states, and "empty" is not the default
 *
 * `idle` (nothing has been asked for yet), `loading`, `ok` and `failed`. A
 * failure renders a SENTENCE, never a table with no rows: "no items are low" and
 * "we could not find out whether any items are low" are different statements,
 * and rendering the second as the first is how a screen comes to reassure
 * somebody about stock it never read.
 *
 * ## Nothing here writes
 *
 * There is no form, no button that submits and no adapter in reach that posts
 * anything. The preferred order quantity is shown under a label that names it as
 * a suggestion, because a bare quantity beside a shortfall reads as an
 * instruction the system is about to carry out.
 */

export type AlertState<T> =
  /** Nothing has been asked for — no branch is named yet. */
  | { readonly phase: 'idle' }
  /** Asked, and the server has not answered. A WAIT, never a refusal. */
  | { readonly phase: 'loading' }
  | { readonly phase: 'ok'; readonly data: T }
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly correlationId: string | null;
    };

const IDLE: AlertState<never> = { phase: 'idle' };
const LOADING: AlertState<never> = { phase: 'loading' };

/**
 * Runs one read and reports it as one of the four states.
 *
 * `enabled` is false until the screen has something to ask about, and the state
 * is then `idle` rather than an empty answer. The caller passes a `load` it owns
 * — wrapped in `useCallback` over the identifiers, never over an object — so a
 * parent that rebuilds its target per render does not re-read without end.
 *
 * ## The phase is DERIVED, never assigned
 *
 * Only the two outcome fields are state, and both are written from inside the
 * answer, never from the body of the effect. Assigning `loading` synchronously
 * when the effect runs is a second render of a component that has just
 * rendered — `react-hooks/set-state-in-effect` refuses it — and it is also the
 * shape that makes "in flight" and "refused" representable at the same time.
 * `useBranches` in the inventory feature derives its phases for the same reason.
 *
 * A card whose TARGET changes is remounted by its caller's `key`, so no answer
 * about one branch can be left on screen while another is being read.
 */
export function useAlertRead<T>(
  load: () => Promise<ReadState<T>>,
  enabled: boolean
): AlertState<T> {
  const [answer, setAnswer] = useState<{ readonly data: T } | null>(null);
  const [failure, setFailure] = useState<{
    readonly messageKey: string;
    readonly correlationId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load().then((read) => {
      if (!live) return;
      if (read.status === 'ok') {
        setAnswer({ data: read.data });
        return;
      }
      setFailure({
        messageKey: refusalKey(read.status),
        correlationId: read.correlationId,
      });
    });
    return () => {
      live = false;
    };
  }, [load, enabled]);

  // Permission first, then failure, then arrival. Nothing outside this function
  // can observe the raw fields, so no caller can read "not asked" as "nothing".
  if (!enabled) return IDLE;
  if (failure !== null) return { phase: 'failed', ...failure };
  if (answer !== null) return { phase: 'ok', data: answer.data };
  return LOADING;
}

/** A quantity exactly as the server stated it. Nothing is rounded or summed. */
function Qty({ value }: { readonly value: string }) {
  return (
    <code className="font-mono" dir="ltr">
      {value}
    </code>
  );
}

/**
 * The frame every card shares: a heading, the rule in words, the freshness
 * stamp, and whatever the read had to say.
 *
 * The stamp is rendered ONLY beside figures that were actually read. A card in
 * its failed state shows no time at all, because the only honest answer to "as
 * of when" is that there is nothing to be as of.
 */
export function AttentionCard({
  messages,
  locale,
  titleKey,
  ruleText,
  state,
  asOf,
  capped,
  emptyKey,
  isEmpty,
  children,
  footer,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly titleKey: string;
  readonly ruleText: string;
  readonly state: AlertState<unknown>;
  readonly asOf: string | null;
  /** True when the server said another page exists behind this one. */
  readonly capped: boolean;
  readonly emptyKey: string;
  readonly isEmpty: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  return (
    <section
      data-testid={`attention-card-${titleKey}`}
      className="rounded-xl border border-border-subtle bg-surface p-4"
    >
      <h3 className="text-section-title font-semibold text-text-primary">{t(titleKey)}</h3>
      <p className="mt-1 text-supporting text-text-secondary">{ruleText}</p>

      {state.phase === 'idle' ? (
        <p className="mt-3 text-body text-text-muted">{t('attention.state.noBranch')}</p>
      ) : null}

      {state.phase === 'loading' ? (
        <p role="status" aria-live="polite" className="mt-3 text-body text-text-muted">
          {t('attention.state.loading')}
        </p>
      ) : null}

      {state.phase === 'failed' ? (
        <p role="alert" className="mt-3 text-body text-error">
          {t(state.messageKey)}
          {state.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono" dir="ltr">
                  {state.correlationId}
                </code>
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {state.phase === 'ok' ? (
        <>
          {isEmpty ? (
            <p className="mt-3 text-body text-text-muted">{t(emptyKey)}</p>
          ) : (
            <div className="mt-3">{children}</div>
          )}
          <p className="mt-3 text-caption text-text-muted">
            {asOf === null
              ? t('attention.asOfMissing')
              : formatMessage(t('attention.asOf'), { when: formatDateTime(asOf, locale) })}
          </p>
          {capped ? <p className="text-caption text-text-muted">{t('attention.capped')}</p> : null}
          {footer ?? null}
        </>
      ) : null}
    </section>
  );
}

/** The table every card draws its rows in. Header cells are always start-aligned. */
function Rows({
  caption,
  headers,
  children,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-table-cell">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-table-border bg-table-header">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 text-start text-table-header font-semibold text-table-header-text"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Cell({ children }: { readonly children: ReactNode }) {
  return <td className="px-3 py-2 text-start text-text-primary">{children}</td>;
}

const LINK = 'text-primary underline-offset-2 hover:underline';

/* ------------------------------------------------------------------ *
 * 1. Low stock
 * ------------------------------------------------------------------ */

export function LowStockCard({
  messages,
  locale,
  companyId,
  branchId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly companyId: string;
  readonly branchId: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const enabled = companyId !== '' && branchId !== '';
  const load = useCallback(
    () => readLowStockAlerts({ companyId, branchId }),
    [companyId, branchId]
  );
  const state = useAlertRead(load, enabled);
  const page = state.phase === 'ok' ? state.data.findings : null;

  return (
    <AttentionCard
      messages={messages}
      locale={locale}
      titleKey="attention.lowStock.title"
      ruleText={t('attention.lowStock.rule')}
      state={state}
      asOf={state.phase === 'ok' ? state.data.asOf : null}
      capped={page?.hasMore ?? false}
      emptyKey="attention.lowStock.empty"
      isEmpty={(page?.items.length ?? 0) === 0}
    >
      <Rows
        caption={t('attention.lowStock.title')}
        headers={[
          t('attention.column.item'),
          t('attention.column.where'),
          t('attention.column.available'),
          t('attention.column.level'),
          t('attention.column.shortfall'),
          t('attention.column.suggestion'),
        ]}
      >
        {(page?.items ?? []).map((row) => (
          <tr key={row.reorderLevelId} className="border-t border-border-subtle">
            <Cell>
              <Link href={attentionLink(locale, 'lowStock', row.itemId)} className={LINK}>
                {row.itemName}
              </Link>
              <span className="block text-caption text-text-muted" dir="ltr">
                {row.sku}
              </span>
            </Cell>
            <Cell>{row.locationCode ?? t('attention.lowStock.wholeBranch')}</Cell>
            <Cell>
              <Qty value={row.availableQty} />
            </Cell>
            <Cell>
              <Qty value={row.reorderLevelQty} />
            </Cell>
            <Cell>
              <Qty value={row.shortfallQty} />
            </Cell>
            <Cell>
              {row.preferredOrderQty === null ? (
                <span className="text-text-muted">{t('attention.lowStock.noSuggestion')}</span>
              ) : (
                <>
                  <Qty value={row.preferredOrderQty} />
                  <span className="block text-caption text-text-muted">
                    {t('attention.lowStock.suggestionOnly')}
                  </span>
                </>
              )}
            </Cell>
          </tr>
        ))}
      </Rows>
    </AttentionCard>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Count discrepancies
 * ------------------------------------------------------------------ */

export function CountDiscrepancyCard({
  messages,
  locale,
  companyId,
  branchId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly companyId: string;
  readonly branchId: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const enabled = companyId !== '' && branchId !== '';
  const load = useCallback(
    () => readCountDiscrepancyAlerts({ companyId, branchId }),
    [companyId, branchId]
  );
  const state = useAlertRead(load, enabled);
  const page = state.phase === 'ok' ? state.data.findings : null;

  return (
    <AttentionCard
      messages={messages}
      locale={locale}
      titleKey="attention.discrepancy.title"
      ruleText={t('attention.discrepancy.rule')}
      state={state}
      asOf={state.phase === 'ok' ? state.data.asOf : null}
      capped={page?.hasMore ?? false}
      emptyKey="attention.discrepancy.empty"
      isEmpty={(page?.items.length ?? 0) === 0}
    >
      <Rows
        caption={t('attention.discrepancy.title')}
        headers={[
          t('attention.column.count'),
          t('attention.column.item'),
          t('attention.column.difference'),
          t('attention.column.decision'),
        ]}
      >
        {(page?.items ?? []).map((row) => (
          <tr key={row.lineId} className="border-t border-border-subtle">
            <Cell>
              <Link href={attentionLink(locale, 'discrepancy')} className={LINK}>
                {t('attention.discrepancy.openCount')}
              </Link>
              <span className="block text-caption text-text-muted">
                {formatDateTime(row.countedOn, locale)}
              </span>
            </Cell>
            <Cell>
              {row.itemName}
              <span className="block text-caption text-text-muted" dir="ltr">
                {row.sku} · {row.locationCode}
              </span>
            </Cell>
            <Cell>
              <Qty value={row.varianceQty} />
            </Cell>
            <Cell>
              {row.adjustmentStatus === null
                ? t('attention.discrepancy.noAdjustment')
                : t(`inventory.adjustmentStatus.${row.adjustmentStatus}`)}
            </Cell>
          </tr>
        ))}
      </Rows>
    </AttentionCard>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Unusual consumption
 * ------------------------------------------------------------------ */

export function UnusualConsumptionCard({
  messages,
  locale,
  companyId,
  branchId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly companyId: string;
  readonly branchId: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const enabled = companyId !== '' && branchId !== '';
  const load = useCallback(
    () => readUnusualConsumptionAlerts({ companyId, branchId }),
    [companyId, branchId]
  );
  const state = useAlertRead(load, enabled);
  const page = state.phase === 'ok' ? state.data.findings : null;

  /*
   * The rule is stated from the server's OWN numbers, in the reader's language.
   * The server also sends the rule as an English sentence; printing that at an
   * Arabic operator would be worse than saying nothing, and inventing the
   * numbers here would describe a question the server was never asked.
   */
  const ruleText =
    state.phase === 'ok'
      ? formatMessage(t('attention.consumption.rule'), {
          multiple: state.data.rule.multiple,
          days: formatInteger(state.data.rule.periodDays, locale),
          periods: formatInteger(state.data.rule.baselinePeriods, locale),
          minimum: state.data.rule.minimumQty,
        })
      : t('attention.consumption.ruleUnread');

  return (
    <AttentionCard
      messages={messages}
      locale={locale}
      titleKey="attention.consumption.title"
      ruleText={ruleText}
      state={state}
      asOf={state.phase === 'ok' ? state.data.asOf : null}
      capped={page?.hasMore ?? false}
      emptyKey="attention.consumption.empty"
      isEmpty={(page?.items.length ?? 0) === 0}
    >
      <Rows
        caption={t('attention.consumption.title')}
        headers={[
          t('attention.column.item'),
          t('attention.column.period'),
          t('attention.column.observed'),
          t('attention.column.baseline'),
        ]}
      >
        {(page?.items ?? []).map((row) => (
          <tr key={row.itemId} className="border-t border-border-subtle">
            <Cell>
              <Link href={attentionLink(locale, 'consumption')} className={LINK}>
                {row.itemName}
              </Link>
              <span className="block text-caption text-text-muted" dir="ltr">
                {row.sku}
              </span>
            </Cell>
            <Cell>
              <span dir="ltr">
                {row.observedPeriod.from} — {row.observedPeriod.to}
              </span>
            </Cell>
            <Cell>
              <Qty value={row.observedQty} />
            </Cell>
            <Cell>
              <Qty value={row.baselineMedianQty} />
              <span className="block text-caption text-text-muted">
                {formatMessage(t('attention.consumption.baselineOver'), {
                  periods: formatInteger(row.baselinePeriods.length, locale),
                })}
              </span>
            </Cell>
          </tr>
        ))}
      </Rows>
    </AttentionCard>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Aged transfers still in transit
 * ------------------------------------------------------------------ */

export function AgedInTransitCard({
  messages,
  locale,
  companyId,
  branchId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly companyId: string;
  readonly branchId: string;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const enabled = companyId !== '' && branchId !== '';
  const load = useCallback(
    () => readAgedInTransitAlerts({ companyId, branchId }),
    [companyId, branchId]
  );
  const state = useAlertRead(load, enabled);
  const page = state.phase === 'ok' ? state.data.findings : null;
  const ruleText =
    state.phase === 'ok'
      ? formatMessage(t('attention.inTransit.rule'), {
          days: formatInteger(state.data.rule.minimumAgeDays, locale),
        })
      : t('attention.inTransit.ruleUnread');

  return (
    <AttentionCard
      messages={messages}
      locale={locale}
      titleKey="attention.inTransit.title"
      ruleText={ruleText}
      state={state}
      asOf={state.phase === 'ok' ? state.data.asOf : null}
      capped={page?.hasMore ?? false}
      emptyKey="attention.inTransit.empty"
      isEmpty={(page?.items.length ?? 0) === 0}
    >
      <Rows
        caption={t('attention.inTransit.title')}
        headers={[
          t('attention.column.transfer'),
          t('attention.column.age'),
          t('attention.column.stillOnItsWay'),
          t('attention.column.branches'),
        ]}
      >
        {(page?.items ?? []).map((row) => (
          <tr key={row.transferId} className="border-t border-border-subtle">
            <Cell>
              <Link href={attentionLink(locale, 'inTransit')} className={LINK}>
                {row.itemName}
              </Link>
              <span className="block text-caption text-text-muted" dir="ltr">
                {row.sku}
              </span>
            </Cell>
            <Cell>
              {formatMessage(t('attention.inTransit.ageDays'), {
                days: formatInteger(row.ageDays, locale),
              })}
            </Cell>
            <Cell>
              <Qty value={row.outstandingQuantity} />
            </Cell>
            <Cell>
              <span dir="ltr">
                {row.fromLocationCode} → {row.toLocationCode}
              </span>
            </Cell>
          </tr>
        ))}
      </Rows>
    </AttentionCard>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Subscription capacity
 * ------------------------------------------------------------------ */

/**
 * How a capacity severity is drawn and what it is called.
 *
 * The three states are ORDERED, and an organisation past its ceiling is the
 * worst of them: it is drawn like the one sitting exactly on it and never like
 * the near band. A severity this screen does not recognise keeps its numbers
 * readable and is given no severity word at all — naming it as the mildest state
 * is the failure this map exists to prevent, and the platform console carries
 * the same map for the same reason.
 */
const SEVERITY = new Map<string, { readonly tone: string; readonly labelKey: string }>([
  [
    'over-limit',
    { tone: 'border-error-border bg-error-subtle', labelKey: 'attention.capacity.overLimit' },
  ],
  [
    'at-limit',
    { tone: 'border-error-border bg-error-subtle', labelKey: 'attention.capacity.atLimit' },
  ],
  [
    'near-limit',
    { tone: 'border-warning-border bg-warning-subtle', labelKey: 'attention.capacity.nearLimit' },
  ],
]);

const SEVERITY_UNKNOWN_TONE = 'border-warning-border bg-warning-subtle';

export function CapacityCard({
  messages,
  locale,
  enabled,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  /** `org.tenant.read`. False means the card is never asked for at all. */
  readonly enabled: boolean;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const load = useCallback(() => readCapacityAlerts(), []);
  const state = useAlertRead<CapacityAlerts>(load, enabled);
  const data = state.phase === 'ok' ? state.data : null;

  return (
    <AttentionCard
      messages={messages}
      locale={locale}
      titleKey="attention.capacity.title"
      ruleText={t('attention.capacity.rule')}
      state={state}
      asOf={data?.asOf ?? null}
      capped={false}
      emptyKey="attention.capacity.empty"
      isEmpty={(data?.alerts.length ?? 0) === 0}
      footer={
        <p className="mt-2 text-caption">
          <Link href={attentionLink(locale, 'capacity')} className={LINK}>
            {t('attention.capacity.open')}
          </Link>
        </p>
      }
    >
      <ul className="flex flex-col gap-2">
        {(data?.alerts ?? []).map((alert) => {
          const presentation = SEVERITY.get(alert.severity);
          const known = (CAPACITY_KINDS as readonly string[]).includes(alert.kind);
          const percent =
            alert.limit > 0 ? Math.min(100, Math.floor((alert.used * 100) / alert.limit)) : 100;
          return (
            <li
              key={alert.kind}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                presentation?.tone ?? SEVERITY_UNKNOWN_TONE
              }`}
            >
              <span className="font-medium text-text-primary">
                {t(known ? `organization.capacity.kind.${alert.kind}` : 'attention.capacity.other')}
              </span>
              <span className="text-supporting text-text-secondary">
                {formatMessage(t('attention.capacity.usage'), {
                  used: formatInteger(alert.used, locale),
                  limit: formatInteger(alert.limit, locale),
                  percent: formatInteger(percent, locale),
                })}
                {presentation ? ` · ${t(presentation.labelKey)}` : null}
              </span>
            </li>
          );
        })}
      </ul>
    </AttentionCard>
  );
}
