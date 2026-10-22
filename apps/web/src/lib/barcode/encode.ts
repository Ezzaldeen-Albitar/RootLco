/**
 * Barcode geometry, computed in this repository and drawn from React elements.
 *
 * ## Why an encoder lives here at all
 *
 * A label has to carry bars a scanner can read. The two ordinary ways to get
 * them are both refused here: a rendering dependency would be a new package for
 * a page of arithmetic, and an HTML string from a generator would need
 * `dangerouslySetInnerHTML`, which this application bans outright. So this
 * module computes GEOMETRY — a list of black bars, each with a start position
 * and a width, in symbol modules — and the component that draws it builds one
 * `<rect>` per bar as a React element. No markup is parsed, nothing is injected,
 * and the drawing step holds no knowledge of any symbology.
 *
 * ## It lives in `lib`, not in the inventory feature
 *
 * Two reasons. A symbology is not an inventory concept — a delivery note or a
 * document label would want the same bars. And the P1-30 closure condition
 * forbids client arithmetic inside the feature trees, which is right for a
 * price and wrong for a checksum: a Code 128 symbol character IS a weighted
 * modulo, and pretending otherwise would mean smuggling it in under a different
 * name. Keeping it here states plainly that this file computes numbers and that
 * none of them is money.
 *
 * ## What is and is not claimed
 *
 * The patterns below are the published symbol tables for Code 128 and for
 * EAN-13/EAN-8/UPC-A. `checkDigitFor` is the GTIN modulo-10 rule, which those
 * three retail symbologies share. Nothing here has been verified against a
 * physical scanner in this repository, and no such claim is made; what IS
 * checked is internal consistency — every Code 128 symbol is eleven modules of
 * three bars and three spaces, every EAN digit is seven, and the check digit
 * agrees with the published rule — because a table with a typo in it fails
 * exactly those properties.
 */

/** The symbologies the backend hints at — `BARCODE_SYMBOLOGIES`, mirrored. */
export const SYMBOLOGIES = ['code128', 'ean13', 'ean8', 'upca', 'itf14'] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];

/** One black bar: where it starts and how wide it is, both in symbol modules. */
export interface Bar {
  readonly x: number;
  readonly width: number;
}

/** A drawable symbol: the bars, the module span they occupy, and the digits under them. */
export interface EncodedBarcode {
  readonly symbology: Symbology;
  /** The value as it was handed in — what the human-readable line shows. */
  readonly value: string;
  /** Total width in modules, quiet zones included. */
  readonly span: number;
  readonly bars: readonly Bar[];
  /** Modules of blank margin on each side, part of `span`. */
  readonly quietZone: number;
}

/**
 * Why a value could not be drawn, as a message key the caller states in words.
 *
 * Never a thrown error: a label screen must be able to say "this code cannot be
 * printed as bars, here is the number" rather than fail to render.
 */
export type EncodeRefusal = 'notDigits' | 'wrongLength' | 'checkDigit' | 'unsupported';

export type EncodeResult =
  | { readonly ok: true; readonly barcode: EncodedBarcode }
  | { readonly ok: false; readonly refusal: EncodeRefusal };

const DIGITS = '0123456789';

/** Modules of blank margin on each side. Nine is the EAN minimum on the wider side. */
const QUIET_ZONE = 9;

/** The digit's value, by position in `DIGITS`; -1 for anything else. No `Number()`. */
const digitValue = (character: string): number => DIGITS.indexOf(character);

const isDigits = (value: string): boolean =>
  value.length > 0 && [...value].every((character) => digitValue(character) >= 0);

/**
 * The GTIN modulo-10 check digit of a payload WITHOUT its check digit.
 *
 * Weights alternate 3 and 1 from the right-hand end of the payload, so the
 * rightmost payload digit always carries 3. EAN-8, UPC-A, EAN-13 and ITF-14 all
 * use this rule, which is why one function serves them all.
 *
 * Returns `null` when the payload is not digits.
 */
export function checkDigitFor(payload: string): string | null {
  if (!isDigits(payload)) return null;
  let weighted = 0;
  const characters = [...payload].reverse();
  for (let index = 0; index < characters.length; index += 1) {
    const value = digitValue(characters[index] as string);
    weighted += index % 2 === 0 ? value * 3 : value;
  }
  const remainder = weighted % 10;
  return DIGITS.charAt(remainder === 0 ? 0 : 10 - remainder);
}

/** True when the last digit of `value` is the check digit the rest of it implies. */
export function hasValidCheckDigit(value: string): boolean {
  if (!isDigits(value) || value.length < 2) return false;
  const body = value.slice(0, -1);
  return checkDigitFor(body) === value.slice(-1);
}

/* ------------------------------------------------------------------ *
 * Code 128
 * ------------------------------------------------------------------ */

/**
 * The 107 Code 128 symbol patterns, as element widths.
 *
 * Each string is six digits — bar, space, bar, space, bar, space — summing to
 * eleven modules, except the stop pattern (106), which is seven elements and
 * thirteen modules. Values 0…94 are the character set; 103, 104 and 105 are the
 * three start characters.
 */
const CODE128_PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

/** Start character of subset B, the set that covers every printable ASCII character. */
const CODE128_START_B = 104;
const CODE128_STOP = 106;
/** Subset B maps a character to its value by ASCII code less 32 (space is 0). */
const CODE128_FIRST_CODE_POINT = 32;
const CODE128_LAST_CODE_POINT = 126;
/** The modulo the running checksum is taken over. */
const CODE128_MODULO = 103;

/**
 * The published table, exposed so a test can hold it to its own invariants
 * rather than to a transcription of itself.
 */
export const CODE128_SYMBOL_PATTERNS = CODE128_PATTERNS;

/** Code 128 subset B. Refuses any character outside printable ASCII. */
function encodeCode128(value: string): EncodeResult {
  const values: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0);
    if (
      point === undefined ||
      point < CODE128_FIRST_CODE_POINT ||
      point > CODE128_LAST_CODE_POINT
    ) {
      return { ok: false, refusal: 'unsupported' };
    }
    values.push(point - CODE128_FIRST_CODE_POINT);
  }
  if (values.length === 0) return { ok: false, refusal: 'wrongLength' };

  let checksum = CODE128_START_B;
  for (let index = 0; index < values.length; index += 1) {
    checksum += (values[index] as number) * (index + 1);
  }
  const symbols = [CODE128_START_B, ...values, checksum % CODE128_MODULO, CODE128_STOP];

  const bars: Bar[] = [];
  let cursor = QUIET_ZONE;
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol] as string;
    let bar = true;
    for (const element of pattern) {
      const width = digitValue(element);
      if (bar) bars.push({ x: cursor, width });
      cursor += width;
      bar = !bar;
    }
  }
  return {
    ok: true,
    barcode: {
      symbology: 'code128',
      value,
      span: cursor + QUIET_ZONE,
      bars,
      quietZone: QUIET_ZONE,
    },
  };
}

/* ------------------------------------------------------------------ *
 * EAN-13, EAN-8 and UPC-A
 * ------------------------------------------------------------------ */

/** Left-hand odd-parity digit patterns, as module bits. */
const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
/** Left-hand even-parity digit patterns. */
const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
/** Right-hand digit patterns — the complement of the odd-parity set. */
const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];

/** Which parity the six left-hand digits take, chosen by the first digit. */
const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const GUARD_EDGE = '101';
const GUARD_CENTRE = '01010';

/** The digit tables, exposed for the same reason as the Code 128 one. */
export const EAN_DIGIT_PATTERNS = { L: EAN_L, G: EAN_G, R: EAN_R };

/** Turns a string of `0`/`1` modules into the black runs inside it. */
function barsOfBits(bits: string, offset: number): Bar[] {
  const bars: Bar[] = [];
  let index = 0;
  while (index < bits.length) {
    if (bits.charAt(index) === '0') {
      index += 1;
      continue;
    }
    const start = index;
    while (index < bits.length && bits.charAt(index) === '1') index += 1;
    bars.push({ x: offset + start, width: index - start });
  }
  return bars;
}

/** EAN-13 from thirteen digits whose last one is the check digit. */
function encodeEan13(value: string): EncodeResult {
  if (!isDigits(value)) return { ok: false, refusal: 'notDigits' };
  if (value.length !== 13) return { ok: false, refusal: 'wrongLength' };
  if (!hasValidCheckDigit(value)) return { ok: false, refusal: 'checkDigit' };

  const parity = EAN13_PARITY[digitValue(value.charAt(0))] as string;
  let bits = GUARD_EDGE;
  for (let index = 0; index < 6; index += 1) {
    const digit = digitValue(value.charAt(index + 1));
    bits += (parity.charAt(index) === 'L' ? EAN_L : EAN_G)[digit] as string;
  }
  bits += GUARD_CENTRE;
  for (let index = 0; index < 6; index += 1) {
    bits += EAN_R[digitValue(value.charAt(index + 7))] as string;
  }
  bits += GUARD_EDGE;
  return {
    ok: true,
    barcode: {
      symbology: 'ean13',
      value,
      span: bits.length + QUIET_ZONE * 2,
      bars: barsOfBits(bits, QUIET_ZONE),
      quietZone: QUIET_ZONE,
    },
  };
}

/** EAN-8 from eight digits whose last one is the check digit. */
function encodeEan8(value: string): EncodeResult {
  if (!isDigits(value)) return { ok: false, refusal: 'notDigits' };
  if (value.length !== 8) return { ok: false, refusal: 'wrongLength' };
  if (!hasValidCheckDigit(value)) return { ok: false, refusal: 'checkDigit' };

  let bits = GUARD_EDGE;
  for (let index = 0; index < 4; index += 1) {
    bits += EAN_L[digitValue(value.charAt(index))] as string;
  }
  bits += GUARD_CENTRE;
  for (let index = 4; index < 8; index += 1) {
    bits += EAN_R[digitValue(value.charAt(index))] as string;
  }
  bits += GUARD_EDGE;
  return {
    ok: true,
    barcode: {
      symbology: 'ean8',
      value,
      span: bits.length + QUIET_ZONE * 2,
      bars: barsOfBits(bits, QUIET_ZONE),
      quietZone: QUIET_ZONE,
    },
  };
}

/**
 * UPC-A from twelve digits.
 *
 * A UPC-A symbol is the EAN-13 symbol of the same number with a leading zero —
 * the bars are identical — so it is encoded as one. The human-readable line
 * keeps the twelve digits the operator knows, which is why `value` is carried
 * separately from what was encoded.
 */
function encodeUpcA(value: string): EncodeResult {
  if (!isDigits(value)) return { ok: false, refusal: 'notDigits' };
  if (value.length !== 12) return { ok: false, refusal: 'wrongLength' };
  if (!hasValidCheckDigit(value)) return { ok: false, refusal: 'checkDigit' };
  const widened = encodeEan13(`0${value}`);
  if (!widened.ok) return widened;
  return { ok: true, barcode: { ...widened.barcode, symbology: 'upca', value } };
}

/**
 * Draw `value` in `symbology`, or say why it cannot be drawn.
 *
 * `itf14` is deliberately refused as `unsupported` rather than approximated in
 * another symbology: a fourteen-digit code printed as Code 128 scans back as a
 * different symbol than the label claims, and a label that lies about what it
 * carries is worse than a label that says it cannot carry it.
 */
export function encodeBarcode(symbology: Symbology, value: string): EncodeResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, refusal: 'wrongLength' };
  switch (symbology) {
    case 'code128':
      return encodeCode128(trimmed);
    case 'ean13':
      return encodeEan13(trimmed);
    case 'ean8':
      return encodeEan8(trimmed);
    case 'upca':
      return encodeUpcA(trimmed);
    default:
      return { ok: false, refusal: 'unsupported' };
  }
}
