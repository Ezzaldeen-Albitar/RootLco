'use client';

import { TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { resolvedTimeZone } from '@/lib/format';
import { validateWindow } from '../appointments-contract';
import { WINDOW_ISSUE_KEY, composeInstant } from '../window-support';

/**
 * A scheduled window — two `datetime-local` inputs composed into
 * offset-bearing instants (P1-28, Wave C — `FE-002`, `FE-003`).
 *
 * ## Errors are rendered against the WINDOW, not one input
 *
 * The backend reports a window violation with the path `body.confirmedFrom`
 * even when the end is the offending half (`appointment-service.ts:184`, a
 * fact the contract layer restates), so a renderer that trusted the path would
 * underline the wrong box. Local validation names the half it can prove; a
 * server complaint about either half is shown once, under the pair.
 *
 * ## The clock is named
 *
 * The composed instants carry the OPERATOR's offset for the chosen wall time
 * (see `window-support.ts` for why), and the legend says which clock that is —
 * a booking made in Amman for a branch in Riyadh is a decision the operator
 * must be able to see, not discover.
 */

export interface WindowDraft {
  /** Raw `datetime-local` values, exactly as typed. */
  readonly from: string;
  readonly to: string;
}

export const EMPTY_WINDOW: WindowDraft = Object.freeze({ from: '', to: '' });

/** The composed instants, or `null` for a half that is not complete yet. */
export function composeWindow(draft: WindowDraft): {
  readonly from: string | null;
  readonly to: string | null;
} {
  return { from: composeInstant(draft.from), to: composeInstant(draft.to) };
}

/**
 * Local refusals for the drafted window, as translation keys. Empty when the
 * window is sendable. Runs the CONTRACT's own validators over the composed
 * instants so this screen and the adapter cannot disagree about legality.
 */
export function windowErrors(draft: WindowDraft): {
  readonly from?: string;
  readonly to?: string;
} {
  const composed = composeWindow(draft);
  const issues = validateWindow(composed.from ?? draft.from, composed.to ?? draft.to);
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
  errors,
  serverError,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly legend: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly draft: WindowDraft;
  readonly onChange: (next: WindowDraft) => void;
  /** Local (submit-time) refusals, as translation keys, by half. */
  readonly errors: { readonly from?: string | undefined; readonly to?: string | undefined };
  /**
   * A backend complaint about EITHER half, as a translation key. Rendered once
   * under the pair — the reported path cannot be trusted to name the half.
   */
  readonly serverError?: string | undefined;
}) {
  const composed = composeWindow(draft);

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-label font-medium text-text-primary">{legend}</legend>
      <p className="text-supporting text-text-muted" lang={locale}>
        {translate(messages, 'appointments.window.clockNote')}{' '}
        <span dir="ltr" className="font-mono text-caption">
          {resolvedTimeZone()}
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={fromLabel}
          type="datetime-local"
          required
          dir="ltr"
          value={draft.from}
          onChange={(event) => onChange({ ...draft, from: event.target.value })}
          error={errors.from ? translateDynamic(messages, errors.from) : undefined}
          description={
            composed.from
              ? `${translate(messages, 'appointments.window.willSend')} ${composed.from}`
              : undefined
          }
        />
        <TextField
          label={toLabel}
          type="datetime-local"
          required
          dir="ltr"
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
          error={errors.to ? translateDynamic(messages, errors.to) : undefined}
          description={
            composed.to
              ? `${translate(messages, 'appointments.window.willSend')} ${composed.to}`
              : undefined
          }
        />
      </div>
      {serverError ? (
        <p role="alert" className="text-supporting text-error">
          {translateDynamic(messages, serverError)}
        </p>
      ) : null}
    </fieldset>
  );
}
