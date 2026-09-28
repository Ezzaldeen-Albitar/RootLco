'use client';

import type { ReactNode } from 'react';
import { ZonedDateTimeField } from '@/components/forms/mui/DateField';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { validateWindow } from '../appointments-contract';
import { WINDOW_ISSUE_KEY } from '../window-support';

/**
 * A scheduled window — two MIT date-and-time pickers (`DateTimeField`) on the
 * BRANCH's clock (P1-28, Wave C — `FE-002`, `FE-003`; ADR-022).
 *
 * ## The values are instants, already carrying their offset
 *
 * `DateTimeField` shows and takes the wall clock of the zone it is given and
 * emits the instant with that zone's offset FOR THAT MOMENT —
 * `2026-09-22T09:30:00+03:00` — daylight saving answered per instant. So the
 * draft holds exactly what the routes accept; nothing is composed here. `''`
 * is "no moment": nothing typed, or a moment typed only in part. A half-typed
 * moment is therefore refused as a missing one, on its own field, and the
 * refused form's cursor lands on the part still to type.
 *
 * ## Whose clock
 *
 * The branch's, and the note says which one. The caller names it: the booking
 * form passes the working branch's zone, and under "all my branches" (or with a
 * branch whose zone is not published) it passes none and the sentence that
 * says why, and no moment is taken — a booking is addressed to one branch. The
 * detail screen passes the appointment's own branch zone, because the record's
 * branch is not necessarily the one in the header; this component reads no
 * working context itself, so a screen reached by a record's address does not
 * reach the working branch through it (`ZonedDateTimeField`).
 *
 * ## Errors are rendered against the WINDOW, not one input
 *
 * The backend reports a window violation with the path `body.confirmedFrom`
 * even when the end is the offending half (`appointment-service.ts:184`), so a
 * renderer that trusted the path would underline the wrong box. Local
 * validation names the half it can prove; a server complaint about either half
 * is shown once, under the pair.
 */

export interface WindowDraft {
  /** An instant with its offset, or `''` for none. */
  readonly from: string;
  readonly to: string;
}

export const EMPTY_WINDOW: WindowDraft = Object.freeze({ from: '', to: '' });

/**
 * Local refusals for the drafted window, as translation keys. Empty when the
 * window is sendable. Runs the CONTRACT's own validators, so this screen and the
 * adapter cannot disagree about legality.
 */
export function windowErrors(draft: WindowDraft): {
  readonly from?: string;
  readonly to?: string;
} {
  const issues = validateWindow(draft.from, draft.to);
  const result: { from?: string; to?: string } = {};
  if (issues.from) result.from = WINDOW_ISSUE_KEY[issues.from];
  if (issues.to) result.to = WINDOW_ISSUE_KEY[issues.to];
  return result;
}

export function WindowFields({
  messages,
  locale,
  legend,
  fromLabel,
  toLabel,
  draft,
  onChange,
  onEdit,
  errors,
  serverError,
  timezone,
  refusal,
  testId = 'appointment-window',
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly legend: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly draft: WindowDraft;
  readonly onChange: (next: WindowDraft) => void;
  /** Called before a half is changed — the caller withdraws that half's complaint. */
  readonly onEdit?: ((half: 'from' | 'to') => void) | undefined;
  /** Local (submit-time) refusals, as translation keys, by half. */
  readonly errors: { readonly from?: string | undefined; readonly to?: string | undefined };
  /**
   * A backend complaint about EITHER half, as a translation key. Rendered once
   * under the pair — the reported path cannot be trusted to name the half.
   */
  readonly serverError?: string | undefined;
  /** The branch's IANA zone, or `null` when no single clock is known. */
  readonly timezone: string | null;
  /** What is said instead of the two moments while there is no clock. */
  readonly refusal?: ReactNode;
  readonly testId?: string | undefined;
}) {
  const zone = timezone;

  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      data-testid={testId}
    >
      <legend className="px-1 text-label font-medium text-text-primary">{legend}</legend>
      {zone === null ? (
        <div data-testid={`${testId}-refused`}>{refusal}</div>
      ) : (
        <p className="text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'appointments.window.clockNote')}{' '}
          <span dir="ltr" className="font-mono text-caption" data-testid={`${testId}-zone`}>
            {zone}
          </span>
        </p>
      )}
      {zone === null ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <ZonedDateTimeField
            messages={messages}
            label={fromLabel}
            required
            value={draft.from}
            timezone={zone}
            onEdit={() => onEdit?.('from')}
            onChange={(from) => onChange({ ...draft, from })}
            error={errors.from ? translateDynamic(messages, errors.from) : undefined}
            testId={`${testId}-from`}
          />
          <ZonedDateTimeField
            messages={messages}
            label={toLabel}
            required
            value={draft.to}
            timezone={zone}
            onEdit={() => onEdit?.('to')}
            onChange={(to) => onChange({ ...draft, to })}
            error={errors.to ? translateDynamic(messages, errors.to) : undefined}
            testId={`${testId}-to`}
          />
        </div>
      )}
      {serverError ? (
        <p role="alert" className="text-supporting text-error">
          {translateDynamic(messages, serverError)}
        </p>
      ) : null}
    </fieldset>
  );
}
