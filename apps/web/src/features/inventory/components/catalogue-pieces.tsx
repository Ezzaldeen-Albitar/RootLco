'use client';

import { useCallback, useRef } from 'react';

import { workingZone } from '@/components/forms/mui/DateField';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import { formatInZone, zoneLabelAt } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';

/**
 * Small pieces the catalogue screens share (P1-32-PRE-OD-INV2A): setup, unit
 * conversions and vehicle specifications.
 */

/**
 * One write at a time, held by a ref rather than by the disabled button.
 *
 * A button disabled by state is disabled only once the screen has re-rendered,
 * so two presses inside one frame both reach the handler. The ref is set before
 * the first await, so the second press finds it set and sends nothing; it is
 * cleared when the write has answered, whatever the answer.
 */
export function useSingleFlight(): (run: () => Promise<void>) => Promise<void> {
  const sending = useRef(false);
  return useCallback(async (run: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    try {
      await run();
    } finally {
      sending.current = false;
    }
  }, []);
}

/**
 * A recorded moment on a NAMED clock, never the browser's.
 *
 * These lists are tenant-wide, so no branch owns the moment: it is written on
 * the clock of the one branch in force, and on UTC under "All my branches" or
 * where that branch's zone is not known — the dashboard's rule — with the
 * clock's name beside it, so a reader can tell which clock it is.
 */
export function RecordedMoment({
  value,
  locale,
}: {
  readonly value: string;
  readonly locale: Locale;
}) {
  const context = useWorkingContext();
  const zone = workingZone(context) ?? 'UTC';
  const language = intlLocale(locale);
  return (
    <span className="whitespace-nowrap">
      <bdi>{formatInZone(value, language, zone)}</bdi>{' '}
      <span className="text-caption text-text-muted">
        <bdi>{zoneLabelAt(value, language, zone)}</bdi>
      </span>
    </span>
  );
}
