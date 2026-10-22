/**
 * Comparing what a page printed with what it was meant to print.
 *
 * A PDF's text comes back in PAINT order. Right-to-left runs are painted in
 * visual order, so an Arabic phrase reads back reversed, and its letters come
 * back as presentation forms. Both sides are therefore folded the same way —
 * compatibility-normalised, with spaces, bidi controls and the separators the
 * identity row uses removed — and a phrase counts as present when it, or its
 * reversal, is found. Digits are left-to-right in both languages and match as
 * written.
 *
 * One more fold, for the lam-alef ligature. A font that draws lam followed by
 * alef as ONE glyph maps it back to the two letters in logical order, inside a
 * run that is otherwise in visual order — so the pair reads the other way round
 * from the letters around it, and whether that happens depends on the font the
 * machine has. Folding both orders of the pair to one makes the comparison
 * independent of it.
 */
const IGNORED = /[\s\u00b7\u2014\u200e\u200f\u2066-\u2069.,:;()'"\u2019-]/gu;
const LAM_ALEF = /\u0644\u0627/gu;
const ALEF_LAM = '\u0627\u0644';

export function fold(text: string): string {
  return text.normalize('NFKC').replace(IGNORED, '').replace(LAM_ALEF, ALEF_LAM);
}

function reverse(text: string): string {
  return [...text.normalize('NFKC')].reverse().join('');
}

function occurrences(haystack: string, needle: string): number {
  if (needle === '') throw new Error('an empty phrase cannot be looked for');
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** How many times `phrase` was printed in `text`, read in either direction. */
export function timesPrinted(text: string, phrase: string): number {
  const haystack = fold(text);
  return Math.max(
    occurrences(haystack, fold(phrase)),
    occurrences(haystack, fold(reverse(phrase)))
  );
}

export function printed(text: string, phrase: string): boolean {
  return timesPrinted(text, phrase) > 0;
}

/**
 * The start of a longer screen sentence, short enough to sit on its first
 * printed line, so a wrapped right-to-left sentence is still recognised.
 */
export function opening(sentence: string): string {
  return [...fold(sentence)].slice(0, 16).join('');
}
