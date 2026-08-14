import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { MEDIA_DECISION_ID, MEDIA_DECISION_KEYS, MEDIA_SURFACE_KEYS } from './media-decision';
import type { MediaSurface } from './media-decision';

/**
 * The named-open-decision notice for reception media (`P1-28-FE-017`).
 *
 * See `media-decision.ts` for why this is the deliverable. Four statements, in
 * the order an operator needs them:
 *
 *   1. what this place is for — so the absence is legible rather than a gap;
 *   2. that capture is blocked, and by which decision, spelled `P1-OD-025`;
 *   3. what the Owner has to decide — read from `MEDIA_DECISION_KEYS`, each of
 *      which restates an open question, never an answer to one;
 *   4. what will exist once it is decided, plus the honest ceiling of the
 *      shipped attachment chain — registered, pending, and not retrievable,
 *      because no storage provider and no scanner exist.
 *
 * ## No control, of any kind
 *
 * No file input, no drag target, no camera affordance, and no disabled button
 * standing in for one. `tests/p1-28-reception-media.test.ts` reads this file's
 * own source and fails on `<button`, `<input`, `<form`, `<a `, `<video`,
 * `<canvas`, `onClick` or `disabled` — the same shape of proof P1-27 uses for
 * the vehicle media section, because a rendered-DOM assertion alone cannot see
 * a control that is merely conditional.
 *
 * ## No number and no file kind, in either catalogue
 *
 * The copy is asserted to contain no digit and no format name. A "sensible
 * default" is the invention the disposition forbids, and it arrives through
 * diligence rather than carelessness.
 *
 * ## `role="note"`, not `role="alert"`
 *
 * This is a standing property of the release, not an event that just happened.
 * An alert would interrupt a screen reader on every step change to say
 * something that was equally true a moment earlier.
 */
export function MediaDecisionNotice({
  locale,
  messages,
  surface,
  headingId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly surface: MediaSurface;
  /** Unique per rendered instance: three surfaces may appear on one screen. */
  readonly headingId: string;
}) {
  return (
    <section
      role="note"
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface-subtle p-4"
    >
      <h4 id={headingId} className="text-body font-medium text-text-primary" lang={locale}>
        {translate(messages, 'receptions.media.heading')}
      </h4>

      <p className="mt-2 text-body text-text-secondary" lang={locale}>
        {translateDynamic(messages, MEDIA_SURFACE_KEYS[surface])}
      </p>

      <p className="mt-2 text-body text-text-primary" lang={locale}>
        {translate(messages, 'receptions.media.blocked')}
      </p>

      <p className="mt-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.media.decisionLabel')}{' '}
        {/* The identifier is a reference, rendered LTR in both locales so it
            reads the same way in the decision log as it does here. */}
        <code className="font-mono" dir="ltr">
          {MEDIA_DECISION_ID}
        </code>
      </p>

      <h5 className="mt-4 text-caption font-medium text-text-secondary" lang={locale}>
        {translate(messages, 'receptions.media.decideHeading')}
      </h5>
      <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-body text-text-secondary">
        {MEDIA_DECISION_KEYS.map((key) => (
          <li key={key} lang={locale}>
            {translateDynamic(messages, key)}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-body text-text-secondary" lang={locale}>
        {translate(messages, 'receptions.media.afterDecision')}
      </p>
      <p className="mt-1 text-caption text-text-muted" lang={locale}>
        {/* The honest ceiling, stated where the promise is made rather than
            left for an operator to discover after the decision lands. */}
        {translate(messages, 'receptions.media.ceiling')}
      </p>
    </section>
  );
}
