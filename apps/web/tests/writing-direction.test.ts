import { describe, expect, it } from 'vitest';

import { writingDirectionOf } from '@/lib/text/writing-direction';

/**
 * The direction a piece of text is written in (P1-32-PRE-OD-UXQ, Q-2).
 *
 * A line that is cut short keeps its beginning only when it is laid out in its
 * own direction, so the header's branch select and every line of a two-line
 * grid cell set `dir` from this answer. The rule is the first letter that has
 * a direction; a text with none follows the page.
 */
describe('the direction a text is written in', () => {
  it('is left to right when its first letter is Latin, Greek or Cyrillic', () => {
    expect(writingDirectionOf('Main workshop')).toBe('ltr');
    expect(writingDirectionOf('Élan garage')).toBe('ltr');
    expect(writingDirectionOf('Αθήνα')).toBe('ltr');
    expect(writingDirectionOf('Москва')).toBe('ltr');
  });

  it('is right to left when its first letter is Arabic or Hebrew', () => {
    expect(writingDirectionOf('الورشة الرئيسية')).toBe('rtl');
    expect(writingDirectionOf('מוסך')).toBe('rtl');
    // A presentation form, as some systems store Arabic.
    expect(writingDirectionOf('ﺍﻟ')).toBe('rtl');
  });

  it('is decided by the FIRST letter of a text in two scripts', () => {
    expect(writingDirectionOf('FQA-1015 ar: أعاد المشتري شفرة مساحة')).toBe('ltr');
    expect(writingDirectionOf('فرع Main')).toBe('rtl');
  });

  it('looks past a leading number, spaces and punctuation to the first letter', () => {
    expect(writingDirectionOf('12 Oct 2026, 09:00')).toBe('ltr');
    expect(writingDirectionOf('2026 أكتوبر')).toBe('rtl');
    expect(writingDirectionOf('  (QA) refund')).toBe('ltr');
    expect(writingDirectionOf('· بواسطتك')).toBe('rtl');
  });

  it.each([
    ['digits only', '000028'],
    ['a figure with its separators', '12.345 · 2026-10-13'],
    ['punctuation only', '— · … ( ) / :'],
    ['white space only', '   '],
    ['an empty text', ''],
  ])('has none for %s: the page decides', (_name, text) => {
    expect(writingDirectionOf(text)).toBeUndefined();
  });

  it('counts Arabic-Indic digits as right to left, which ASCII digits are not', () => {
    // The limit of the rule as written: the whole Arabic block is one range.
    expect(writingDirectionOf('٠٧٩')).toBe('rtl');
    expect(writingDirectionOf('079')).toBeUndefined();
  });
});
