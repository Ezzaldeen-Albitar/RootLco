import { describe, expect, it } from 'vitest';

import {
  CODE128_SYMBOL_PATTERNS,
  EAN_DIGIT_PATTERNS,
  checkDigitFor,
  encodeBarcode,
  hasValidCheckDigit,
} from '@/lib/barcode/encode';

/**
 * The barcode encoder, held to the properties a wrong table breaks.
 *
 * ## Why these properties and not a golden image
 *
 * Nothing in this repository can put a symbol in front of a scanner, so a test
 * that compared the bars against a second copy of the same table would prove
 * only that the copy was made correctly. The published symbologies have
 * STRUCTURAL invariants instead — every Code 128 symbol is eleven modules of
 * three bars and three spaces, every EAN digit is seven modules, the guards sit
 * where the guards sit, and the check digit is a stated arithmetic rule — and a
 * transcription error breaks at least one of them. That is what is asserted
 * here.
 */

describe('the Code 128 symbol table is internally consistent', () => {
  it('holds the 107 published symbols', () => {
    expect(CODE128_SYMBOL_PATTERNS.length).toBe(107);
  });

  it('gives every symbol but the stop eleven modules in six elements', () => {
    const digits = (pattern: string) => [...pattern].map((d) => '0123456789'.indexOf(d));
    for (let index = 0; index < 106; index += 1) {
      const pattern = CODE128_SYMBOL_PATTERNS[index] as string;
      const widths = digits(pattern);
      expect(widths.length, `symbol ${index} has ${widths.length} elements`).toBe(6);
      expect(
        widths.reduce((sum, w) => sum + w, 0),
        `symbol ${index} is not eleven modules wide`
      ).toBe(11);
      expect(
        widths.every((w) => w >= 1 && w <= 4),
        `symbol ${index} has an element out of range`
      ).toBe(true);
    }
  });

  it('gives the stop symbol thirteen modules in seven elements', () => {
    const stop = CODE128_SYMBOL_PATTERNS[106] as string;
    const widths = [...stop].map((d) => '0123456789'.indexOf(d));
    expect(widths.length).toBe(7);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBe(13);
  });

  it('holds no duplicate symbol, which a copy-paste slip would create', () => {
    expect(new Set(CODE128_SYMBOL_PATTERNS).size).toBe(CODE128_SYMBOL_PATTERNS.length);
  });
});

describe('the EAN digit tables are internally consistent', () => {
  it('gives every digit seven modules in all three sets', () => {
    for (const [name, table] of Object.entries(EAN_DIGIT_PATTERNS)) {
      expect(table.length, `${name} has ${table.length} digits`).toBe(10);
      for (const bits of table) {
        expect(bits.length, `${name} has a digit that is not seven modules`).toBe(7);
        expect(/^[01]{7}$/.test(bits), `${name} has a digit that is not modules`).toBe(true);
      }
    }
  });

  it('makes the right-hand set the exact complement of the odd-parity set', () => {
    // The published relationship, and the one a single mistyped bit breaks.
    for (let digit = 0; digit < 10; digit += 1) {
      const left = EAN_DIGIT_PATTERNS.L[digit] as string;
      const right = EAN_DIGIT_PATTERNS.R[digit] as string;
      const flipped = [...left].map((bit) => (bit === '0' ? '1' : '0')).join('');
      expect(right, `digit ${digit}`).toBe(flipped);
    }
  });

  it('makes the even-parity set the reverse of the right-hand set', () => {
    for (let digit = 0; digit < 10; digit += 1) {
      const even = EAN_DIGIT_PATTERNS.G[digit] as string;
      const right = EAN_DIGIT_PATTERNS.R[digit] as string;
      expect(even, `digit ${digit}`).toBe([...right].reverse().join(''));
    }
  });
});

describe('the check digit follows the published rule', () => {
  // Each case is a published code WITHOUT its final digit, and the digit the
  // rule says that code must end with.
  it.each([
    ['400638133393', '1'],
    ['9638507', '4'],
    ['03600029145', '2'],
    ['01234567890', '5'],
  ])('computes the check digit of %s as %s', (body, expected) => {
    expect(checkDigitFor(body)).toBe(expected);
  });

  it('accepts a code whose last digit is the one the rest implies', () => {
    const body = '400638133393';
    expect(hasValidCheckDigit(`${body}${checkDigitFor(body) as string}`)).toBe(true);
  });

  it('refuses a code whose last digit is wrong', () => {
    const body = '400638133393';
    const right = checkDigitFor(body) as string;
    const wrong = right === '0' ? '1' : '0';
    expect(hasValidCheckDigit(`${body}${wrong}`)).toBe(false);
  });

  it('refuses a payload that is not digits rather than computing over it', () => {
    expect(checkDigitFor('40063A1333')).toBeNull();
    expect(hasValidCheckDigit('40063A13331')).toBe(false);
  });
});

describe('encoding produces bars a label can be drawn from', () => {
  it('draws a Code 128 symbol for a code with letters in it', () => {
    const result = encodeBarcode('code128', 'WS-000123');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Start, nine characters, checksum, stop: eleven eleven-module symbols plus
    // the thirteen-module stop, inside two quiet zones of nine.
    expect(result.barcode.span).toBe(9 + 11 * 11 + 13 + 9);
    expect(result.barcode.bars.length).toBeGreaterThan(0);
    // The first bar starts after the quiet zone, and nothing runs past the span.
    expect(result.barcode.bars[0]?.x).toBe(result.barcode.quietZone);
    for (const bar of result.barcode.bars) {
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(result.barcode.span);
    }
  });

  it('draws EAN-13 as guards, six digits, guards, six digits and guards', () => {
    const result = encodeBarcode('ean13', '4006381333931');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.barcode.span).toBe(9 + 95 + 9);
    // Every bar sits inside the printed area, and none is wider than four
    // modules — the widest run any EAN pattern can produce.
    for (const bar of result.barcode.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(9);
      expect(bar.width).toBeLessThanOrEqual(4);
    }
  });

  it('draws UPC-A on the EAN-13 bars while keeping the twelve digits readable', () => {
    const upc = encodeBarcode('upca', '036000291452');
    expect(upc.ok).toBe(true);
    if (!upc.ok) return;
    expect(upc.barcode.value).toBe('036000291452');
    expect(upc.barcode.symbology).toBe('upca');
    const widened = encodeBarcode('ean13', '0036000291452');
    expect(widened.ok).toBe(true);
    if (!widened.ok) return;
    expect(upc.barcode.bars).toEqual(widened.barcode.bars);
  });

  it('draws EAN-8', () => {
    const result = encodeBarcode('ean8', '96385074');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.barcode.span).toBe(9 + 67 + 9);
  });

  it('refuses a retail code whose check digit is wrong rather than drawing it', () => {
    const result = encodeBarcode('ean13', '4006381333930');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('checkDigit');
  });

  it('refuses a retail code of the wrong length', () => {
    const result = encodeBarcode('ean13', '40063813339');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('wrongLength');
  });

  it('refuses a retail code with a letter in it', () => {
    const result = encodeBarcode('ean13', '400638133393A');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('notDigits');
  });

  it('refuses a symbology it does not draw rather than drawing another one', () => {
    const result = encodeBarcode('itf14', '10614141000415');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('unsupported');
  });

  it('refuses an empty code', () => {
    const result = encodeBarcode('code128', '   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('wrongLength');
  });
});
