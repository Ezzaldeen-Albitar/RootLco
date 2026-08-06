/**
 * Reading a duplicate match score, without ever parsing it as a number.
 *
 * ## Why the string is never parsed
 *
 * `match_score` is PostgreSQL `numeric`. node-postgres decodes `numeric` to a
 * string precisely because it does not fit a JavaScript double, and the CRM and
 * Vehicle repositories both say so in their own docblocks. This number decides
 * whether two real customer or vehicle records are treated as the same thing, so
 * a rounding artefact here is not a display bug — it is a wrong answer to a
 * question a person is about to act on.
 *
 * Everything below works on the CHARACTERS the database sent.
 *
 * ## Why a percentage integer is not "parsing it"
 *
 * `percentOf` reads the first three digits after the decimal point, decides the
 * third digit's rounding by comparison, and adds two small integers. No division,
 * no `parseFloat`, no `Number(score)`. The result is an exact integer 0…100 that
 * can be compared and rendered; the canonical decimal string is never replaced by
 * it and is still available for anyone who needs the precise value.
 */

/**
 * The percentage a score represents, as an exact integer, or `null` for any
 * shape this does not recognise.
 *
 * `null` matters: an unexpected representation must be shown raw rather than
 * rendered as a confident wrong number.
 */
export function percentOf(score: string): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(score.trim());
  if (!match) return null;

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';

  // A score is a 0..1 ratio. Anything else is not a shape this understands.
  if (whole !== '0' && whole !== '1') return null;
  if (whole === '1' && /[1-9]/.test(fraction)) return null;
  if (whole === '1') return 100;

  // Percent = the first two fractional digits, with the third rounded in by
  // digit comparison rather than by float arithmetic.
  const digits = (fraction + '000').slice(0, 3);
  const tens = Number(digits.slice(0, 2));
  const roundUp = Number(digits[2]) >= 5;
  return Math.min(100, tens + (roundUp ? 1 : 0));
}

/** The score as a percentage for display, or `null` if the shape is unknown. */
export function formatPercent(score: string): string | null {
  const percent = percentOf(score);
  return percent === null ? null : `${percent}%`;
}

/**
 * How confident the detector was, in words a workshop employee reads.
 *
 * The Product Owner's requirement, verbatim: "Human-readable confidence such as:
 * Strong match. Possible match. Needs review." A bare `0.8500` tells an operator
 * nothing about whether to look hard or glance.
 *
 * `null` when the score's shape is unrecognised — a band is a claim, and a claim
 * must not be invented from a value that was not understood.
 */
export type MatchConfidence = 'strong' | 'possible' | 'review';

export interface ConfidenceBands {
  /** At or above this percentage: a strong match. */
  readonly strong: number;
  /** At or above this percentage: a possible match. */
  readonly possible: number;
}

export function confidenceOf(score: string, bands: ConfidenceBands): MatchConfidence | null {
  const percent = percentOf(score);
  if (percent === null) return null;
  if (percent >= bands.strong) return 'strong';
  if (percent >= bands.possible) return 'possible';
  return 'review';
}

/** The message key for a confidence band. Never the band name itself. */
export function confidenceKey(confidence: MatchConfidence): string {
  return `duplicates.confidence.${confidence}`;
}
