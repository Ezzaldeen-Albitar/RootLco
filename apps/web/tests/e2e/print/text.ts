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
 */
const IGNORED = /[\s·—‎‏⁦-⁩.,:;()'"’-]/gu;

export function fold(text: string): string {
  return text.normalize('NFKC').replace(IGNORED, '');
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
  const needle = fold(phrase);
  const reversed = [...needle].reverse().join('');
  return Math.max(occurrences(haystack, needle), occurrences(haystack, reversed));
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
