/**
 * The direction a piece of text is written in, read from the text itself.
 *
 * ## What it is for
 *
 * A line that is cut short keeps its BEGINNING only when it is laid out in its
 * own direction. A Latin name in the Arabic interface, laid out right to left
 * like the page around it, overflows at the left: its first words are the ones
 * that go. Laid out left to right it keeps them and ends in the ellipsis, as an
 * Arabic name does in the English interface. So a control that cuts text short
 * sets `dir` from the text, not from the page — the header's working-branch
 * select (checkpoint browser QA, DEF-01) and every line of a two-line grid cell
 * (P1-32-PRE-OD-UXQ, Q-2).
 *
 * ## Why not `dir="auto"`
 *
 * The attribute asks the browser the same question, but it does not look
 * inside a `<bdi>` or inside an element that carries a `dir` of its own, and
 * that is how most callers hand a name over. A line holding only an Arabic
 * name inside a `<bdi>` has, to `auto`, no letter at all, and falls back to
 * left to right — in the Arabic interface that would cut the beginning off a
 * name that is whole today. Reading the text here has no such blind spot, and
 * gives the same answer on the server and in the browser.
 *
 * One authority: the two regular expressions lived in the branch selector and
 * were moved here when a second caller needed them, rather than copied.
 */

/**
 * A letter of a right-to-left script: Hebrew, Arabic and their presentation
 * forms. Written as escapes, so that this file holds no right-to-left
 * character and reads the same in every editor. The first range is the whole
 * Arabic block, so the Arabic-Indic digits in it count as right-to-left too,
 * which ASCII digits do not.
 */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
/** A letter of a left-to-right script. */
const LTR_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/u;

/**
 * The direction a text is written in, from its first letter that has one, or
 * `undefined` for a text with none (digits and punctuation follow the page).
 */
export function writingDirectionOf(text: string): 'rtl' | 'ltr' | undefined {
  for (const character of text) {
    if (RTL_LETTER.test(character)) return 'rtl';
    if (LTR_LETTER.test(character)) return 'ltr';
  }
  return undefined;
}
