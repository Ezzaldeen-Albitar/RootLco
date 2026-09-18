'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime, formatInteger } from '@/lib/format';

import { readCountDiscrepancyAlerts, readLowStockAlerts } from '../api';
import type { StockTarget } from '../inventory-contract';

/**
 * The low-stock and count-difference signals, where the work happens.
 *
 * The Attention area is where somebody goes to look; this is what finds them
 * while they are already on an inventory screen. It is deliberately COMPACT —
 * two sentences and a link — because a second full table on a working screen
 * competes with the screen's own job.
 *
 * ## It never writes, and it never invents a number
 *
 * Both reads are `GET`s. The figure shown is the number of findings on the first
 * page, and when the server said another page exists the sentence says "at
 * least" rather than publishing a total nobody counted. The freshness stamp is
 * the database's own instant, taken from the low-stock answer.
 *
 * ## A refusal is not a zero
 *
 * If either read is refused or fails, the indicator says the signals could not
 * be read. Rendering "0 low on stock" there would be a statement about the
 * branch's stock that no read established — and on a screen an operator is
 * working from, that is the more dangerous of the two mistakes.
 *
 * It is stated quietly, without an alert role: this is a decoration on somebody
 * else's screen, and interrupting a screen reader mid-task to report that a
 * secondary signal is unavailable would be the wrong trade.
 */

interface Signal {
  readonly count: number;
  readonly atLeast: boolean;
}

interface Reading {
  readonly lowStock: Signal | null;
  readonly discrepancies: Signal | null;
  readonly asOf: string | null;
  readonly failed: boolean;
}

const UNREAD: Reading = { lowStock: null, discrepancies: null, asOf: null, failed: false };

export function StockAlertIndicator({
  messages,
  locale,
  target,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  /** The branch the surrounding screen is showing, or nothing chosen yet. */
  readonly target: StockTarget | null;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const companyId = target?.companyId ?? null;
  const branchId = target?.branchId ?? null;
  /**
   * The answer AND the branch it is about.
   *
   * Carrying the pair with the figures is what keeps one branch's signals off
   * the screen while another branch is being read: the render below uses the
   * answer only when its pair is the one on screen. The alternative — clearing
   * the state at the top of the effect — is a synchronous `setState` inside an
   * effect, which `react-hooks/set-state-in-effect` refuses and which re-renders
   * a component that has just rendered.
   */
  const [reading, setReading] = useState<{ readonly of: string; readonly value: Reading } | null>(
    null
  );
  const pairKey = `${companyId ?? ''}:${branchId ?? ''}`;

  const read = useCallback(async (): Promise<Reading> => {
    if (companyId === null || branchId === null) return UNREAD;
    const pair = { companyId, branchId };
    const [low, counts] = await Promise.all([
      readLowStockAlerts(pair, 5),
      readCountDiscrepancyAlerts(pair, 5),
    ]);
    return {
      lowStock:
        low.status === 'ok'
          ? { count: low.data.findings.items.length, atLeast: low.data.findings.hasMore }
          : null,
      discrepancies:
        counts.status === 'ok'
          ? { count: counts.data.findings.items.length, atLeast: counts.data.findings.hasMore }
          : null,
      asOf: low.status === 'ok' ? low.data.asOf : null,
      failed: low.status !== 'ok' || counts.status !== 'ok',
    };
  }, [companyId, branchId]);

  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (live) setReading({ of: pairKey, value: next });
    });
    return () => {
      live = false;
    };
  }, [read, pairKey]);

  // Nothing is claimed about a branch nobody has named, and nothing is claimed
  // about this one until its own answer has arrived.
  if (companyId === null || branchId === null) return null;
  if (reading === null || reading.of !== pairKey) return null;
  const answer = reading.value;

  const sentence = (signal: Signal | null, one: string, many: string): string | null => {
    if (signal === null) return null;
    return formatMessage(translateDynamic(messages, signal.atLeast ? many : one), {
      count: formatInteger(signal.count, locale),
    });
  };

  const low = sentence(
    answer.lowStock,
    'inventory.signals.lowStock',
    'inventory.signals.lowStockAtLeast'
  );
  const differences = sentence(
    answer.discrepancies,
    'inventory.signals.differences',
    'inventory.signals.differencesAtLeast'
  );
  const quiet =
    answer.lowStock !== null &&
    answer.discrepancies !== null &&
    answer.lowStock.count === 0 &&
    answer.discrepancies.count === 0 &&
    !answer.lowStock.atLeast &&
    !answer.discrepancies.atLeast;

  return (
    <aside
      data-testid="stock-alert-indicator"
      className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2"
    >
      <p className="text-supporting text-text-secondary">
        {quiet ? (
          t('inventory.signals.quiet')
        ) : (
          <>
            {low === null ? null : <span className="block">{low}</span>}
            {differences === null ? null : <span className="block">{differences}</span>}
          </>
        )}
        {answer.failed ? (
          <span className="block text-text-muted">{t('inventory.signals.unavailable')}</span>
        ) : null}
      </p>
      <p className="mt-1 text-caption text-text-muted">
        {answer.asOf === null
          ? t('inventory.signals.asOfMissing')
          : formatMessage(t('attention.asOf'), { when: formatDateTime(answer.asOf, locale) })}
      </p>
      <p className="mt-1 text-caption">
        <Link
          href={`/${locale}/attention`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {t('inventory.signals.open')}
        </Link>
      </p>
    </aside>
  );
}
