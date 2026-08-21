import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  confidenceKey,
  confidenceOf,
  formatPercent,
  type ConfidenceBands,
} from '@/lib/duplicates/score';

/**
 * Why two records were matched, in business language.
 *
 * One component for both domains, because the Product Owner's requirement is the
 * same on both screens and two implementations would drift: the CRM one learned
 * the merge-affordance rule the hard way and the vehicle one inherited it, and
 * this is the same shape of shared obligation.
 *
 * ## What it shows
 *
 *   1. A confidence band — Strong match / Possible match / Needs review — because
 *      "0.8500" tells a receptionist nothing about whether to look hard.
 *   2. The exact score, as a percentage AND as the canonical decimal the database
 *      froze at detection. Secondary, small, and clearly a supporting detail; a
 *      reviewer who has to justify a decision later needs the precise number.
 *   3. One sentence per comparison that fired.
 *   4. A sentence saying the system is warning, not deciding.
 *
 * ## What it never shows
 *
 * The stored evidence object, in any form. No JSON, no signal names, no weights,
 * no classification labels, and no identifier values. If the backend records a
 * comparison this build has no wording for, the operator gets "compare the two
 * records" — not the internal name of the comparison.
 */

export interface MatchExplanationProps {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The canonical decimal string. Never parsed, never rounded away. */
  readonly score: string;
  readonly bands: ConfidenceBands;
  /** Catalogue keys from `lib/duplicates/explanations`. */
  readonly reasonKeys: readonly string[];
}

const BADGE: Readonly<Record<string, string>> = {
  strong: 'bg-warning-subtle text-text-primary border-warning-border',
  possible: 'bg-info-subtle text-text-primary border-info-border',
  review: 'bg-surface-subtle text-text-secondary border-border',
};

export function MatchExplanation({
  locale,
  messages,
  score,
  bands,
  reasonKeys,
}: MatchExplanationProps) {
  const confidence = confidenceOf(score, bands);
  const percent = formatPercent(score);

  return (
    <section
      aria-label={translate(messages, 'duplicates.reasonsHeading')}
      data-testid="match-explanation"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium text-text-primary">
          {translate(messages, 'duplicates.reasonsHeading')}
        </h3>
        {confidence ? (
          <span
            data-testid="match-confidence"
            className={`rounded-full border px-2 py-0.5 text-caption font-medium ${BADGE[confidence] ?? BADGE.review}`}
          >
            {translateDynamic(messages, confidenceKey(confidence))}
          </span>
        ) : null}
        {/*
          The number, kept as supporting evidence rather than as the headline.
          `dir="ltr"` because a percentage and a decimal both read left to right
          in Arabic, and the canonical string is shown exactly as the database
          sent it — the percentage is derived from its digits, not from a float.
        */}
        <span className="text-caption text-text-muted" dir="ltr">
          {percent === null ? score : `${percent} · ${score}`}
        </span>
      </div>

      {reasonKeys.length > 0 ? (
        <ul
          className="flex list-disc flex-col gap-1 ps-5 text-body text-text-secondary"
          lang={locale}
        >
          {reasonKeys.map((key) => (
            <li key={key}>{translateDynamic(messages, key)}</li>
          ))}
        </ul>
      ) : (
        // No evidence at all is a real state — a candidate recorded before the
        // detector stored its basis, or a basis of an unexpected shape. Saying
        // so is better than an empty box that looks like a rendering failure.
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'duplicates.reason.none')}
        </p>
      )}

      {/*
        The most important sentence on the screen. A machine that surfaces two
        records as "possibly the same" is easy to read as a machine that has
        decided they are, and the consequence of acting on that without checking
        is two real customers' histories being combined.
      */}
      <p className="text-supporting text-text-muted" lang={locale}>
        {translate(messages, 'duplicates.warningNotDecision')}
      </p>
    </section>
  );
}
