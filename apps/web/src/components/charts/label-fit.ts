/**
 * How much room a run of chart text needs, and how to cut one that has none.
 *
 * Nothing that renders the page on the server or in a test can measure a glyph
 * run, and measuring after mount would draw one frame of overflowing text
 * before correcting it. So text is BUDGETED rather than measured, and each
 * budget is chosen at or above the typical advance of its class in common
 * sans-serif faces:
 *
 *   - the widest Latin glyphs (`M`, `W`, `m`, `w`, `@`, `%`), the ellipsis, an
 *     em dash, and East Asian wide characters: a whole em;
 *   - any other uppercase letter: 0.8 em — capitals run wider than the 0.6 em
 *     average a first budget assumed, which is how an all-caps label overflowed
 *     its column;
 *   - everything else, Arabic included: 0.72 em.
 *
 * The one budget both the dashboard's hand-drawn charts and `ChartPanel` fit
 * labels and reserve count gutters with. The face actually drawn is confirmed
 * by eye in browser QA.
 */

/** Glyphs budgeted at a whole em. */
const WIDE_GLYPHS = new Set(['M', 'W', 'm', 'w', '@', '%', '…', '—']);

/** A glyph's width budget, in ems — a conservative estimate by glyph class. */
function glyphEms(character: string): number {
  if (WIDE_GLYPHS.has(character)) return 1;
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint >= 0x2e80) return 1;
  if (/\p{Lu}/u.test(character)) return 0.8;
  return 0.72;
}

/**
 * The budgeted width of a run of text at a font size, in drawing units. Counted
 * in code points rather than UTF-16 units, so a character stored as two is
 * budgeted once.
 */
export function estimatedTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, character) => sum + glyphEms(character), 0) * fontSize;
}

/**
 * The label as drawn: whole if its budgeted width fits, otherwise cut —
 * ellipsis included — to the longest prefix that does, and never to an
 * ellipsis on its own. A label that is cut must keep its whole text somewhere a
 * reader can reach: a `<title>`, a tooltip, the table alternative.
 */
export function fitLabel(label: string, maxWidth: number, fontSize: number): string {
  if (estimatedTextWidth(label, fontSize) <= maxWidth) return label;
  const room = maxWidth - estimatedTextWidth('…', fontSize);
  const kept: string[] = [];
  let used = 0;
  for (const character of Array.from(label)) {
    const width = glyphEms(character) * fontSize;
    if (used + width > room) break;
    kept.push(character);
    used += width;
  }
  const prefix = kept.length === 0 ? Array.from(label).slice(0, 1) : kept;
  return `${prefix.join('').trimEnd()}…`;
}
