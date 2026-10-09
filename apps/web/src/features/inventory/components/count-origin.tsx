'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

import { readStockCount } from '../api';
import type { StockAdjustment } from '../inventory-contract';
import { LINK, StockMoment } from './stock-operations';

/**
 * Where an adjustment came from, when a stock count raised it
 * (P1-32-PRE-OD-INVF, LANG-identifiers).
 *
 * Reconciling a count raises one pending adjustment per difference, and the
 * database writes that adjustment's reason itself, as the words `stock count`
 * followed by the count's identifier
 * (`supabase/migrations/20260917090000_inv_transfers_receipts_counts.sql`). The
 * screen printed that reason as it was stored, so the operator read a
 * 36-character reference where a person's reason belongs.
 *
 * The reason is read as a count's only when the count confirms it: the count is
 * read through `inv.stock-count-read` (`inv.stock.read`, which this screen's
 * route already requires) and one of its lines must name this adjustment. Then
 * the row says it was raised by a stock count, when that count began on the
 * branch clock, and links to the counts. A count that cannot be read says the
 * same in words and that its details are not available — never the reference.
 * A reason someone typed is shown exactly as typed.
 */

const COUNT_REASON =
  /^stock count ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The count a database-written reason names, or null for a reason a person typed. */
export function countIdOf(reason: string): string | null {
  return COUNT_REASON.exec(reason)?.[1] ?? null;
}

export type CountOrigin =
  | { readonly kind: 'typed' }
  | { readonly kind: 'count'; readonly phase: 'pending' | 'unavailable' }
  | { readonly kind: 'count'; readonly phase: 'confirmed'; readonly startedAt: string };

const TYPED: CountOrigin = { kind: 'typed' };
const PENDING: CountOrigin = { kind: 'count', phase: 'pending' };
const UNAVAILABLE: CountOrigin = { kind: 'count', phase: 'unavailable' };

/** What a count read answered: the adjustments its lines raised and when it began, or nothing. */
type CountAnswer = {
  readonly startedAt: string;
  readonly adjustmentIds: ReadonlySet<string>;
} | null;

/**
 * The origin of each listed adjustment, reading each count its rows name once.
 */
export function useCountOrigins(
  adjustments: readonly StockAdjustment[] | null
): (adjustment: StockAdjustment) => CountOrigin {
  const key = useMemo(
    () =>
      [
        ...new Set(
          (adjustments ?? []).flatMap((row) => {
            const countId = countIdOf(row.reason);
            return countId === null ? [] : [countId.toLowerCase()];
          })
        ),
      ]
        .sort()
        .join(','),
    [adjustments]
  );
  const [answers, setAnswers] = useState<ReadonlyMap<string, CountAnswer>>(new Map());
  useEffect(() => {
    if (key === '') return;
    let live = true;
    for (const countId of key.split(',')) {
      void readStockCount(countId).then((state) => {
        if (!live) return;
        const answer: CountAnswer =
          state.status === 'ok'
            ? {
                startedAt: state.data.snapshotAt,
                adjustmentIds: new Set(
                  state.data.lines.flatMap((line) =>
                    line.adjustmentId === null ? [] : [line.adjustmentId]
                  )
                ),
              }
            : null;
        setAnswers((known) => new Map(known).set(countId, answer));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);
  return useCallback(
    (adjustment: StockAdjustment) => {
      const countId = countIdOf(adjustment.reason);
      if (countId === null) return TYPED;
      const answer = answers.get(countId.toLowerCase());
      if (answer === undefined) return PENDING;
      if (answer === null) return UNAVAILABLE;
      return answer.adjustmentIds.has(adjustment.id)
        ? { kind: 'count', phase: 'confirmed', startedAt: answer.startedAt }
        : TYPED;
    },
    [answers]
  );
}

/** An adjustment's reason in words: a person's own, or the count that raised it. */
export function AdjustmentReason({
  locale,
  messages,
  zone,
  adjustment,
  origin,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The branch clock a count's start is written on. */
  readonly zone: string;
  readonly adjustment: StockAdjustment;
  readonly origin: CountOrigin;
}) {
  if (origin.kind === 'typed') return <bdi>{adjustment.reason}</bdi>;
  return (
    <span data-testid="adjustment-from-count">
      {translate(messages, 'inventory.adjustments.fromCount')}
      {origin.phase === 'confirmed' ? (
        <>
          {' '}
          {translate(messages, 'inventory.adjustments.fromCountStarted')}{' '}
          <StockMoment value={origin.startedAt} locale={locale} zone={zone} />
        </>
      ) : origin.phase === 'unavailable' ? (
        <> {translate(messages, 'inventory.adjustments.fromCountUnavailable')}</>
      ) : null}{' '}
      <Link href={`/${locale}/inventory/counts`} className={LINK}>
        {translate(messages, 'inventory.adjustments.fromCountOpen')}
      </Link>
    </span>
  );
}
