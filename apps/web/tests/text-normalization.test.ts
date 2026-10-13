/**
 * Browser-side text folding (P1-32 friendly search).
 *
 * `apps/web/src/lib/text/normalization.ts` prepares the query fragment a search
 * screen sends, so each rule it mirrors from the database is held here on the
 * web copy itself. The database-tier parity suite proves the SQL agrees; this
 * file proves the copy the browser actually runs behaves as documented.
 */
import { describe, expect, it } from 'vitest';

import {
  foldDigits,
  foldSearchText,
  normalizePhoneDigits,
  normalizePlate,
  normalizeVin,
} from '@/lib/text/normalization';

describe('foldDigits', () => {
  it('folds both Arabic-Indic digit blocks to ASCII and keeps the length', () => {
    const arabicIndic = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    const easternArabicIndic = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';
    expect(foldDigits(arabicIndic)).toBe('0123456789');
    expect(foldDigits(easternArabicIndic)).toBe('0123456789');
    expect(foldDigits(`A${arabicIndic}`)).toHaveLength(11);
  });

  it('leaves every other character untouched', () => {
    expect(foldDigits('ab-12 \u0627')).toBe('ab-12 \u0627');
  });
});

describe('foldSearchText', () => {
  it('strips tatweel and tashkeel and collapses the alef forms onto bare alef', () => {
    expect(foldSearchText('\u0623\u062D\u0640\u0645\u064E\u062F')).toBe('\u0627\u062D\u0645\u062F');
    expect(foldSearchText('\u0625\u0622')).toBe('\u0627\u0627');
  });

  it('keeps taa marbuta distinct from haa', () => {
    expect(foldSearchText('\u0629')).toBe('\u0629');
    expect(foldSearchText('\u0629')).not.toBe(foldSearchText('\u0647'));
  });

  it('lowercases, folds digits, collapses POSIX whitespace and trims spaces', () => {
    expect(foldSearchText('  Some\t\tWORDS \u0661\u0662  ')).toBe('some words 12');
  });

  it('turns a blank or missing value into null', () => {
    expect(foldSearchText('   ')).toBeNull();
    expect(foldSearchText(null)).toBeNull();
    expect(foldSearchText(undefined)).toBeNull();
  });
});

describe('normalizePhoneDigits', () => {
  it('keeps one leading plus and the digits, folding Arabic-Indic digits first', () => {
    expect(normalizePhoneDigits(' +962 (7\u0669) 123-4567')).toBe('+962791234567');
  });

  it('reproduces the frozen lone-plus result', () => {
    expect(normalizePhoneDigits('+')).toBe('+');
  });

  it('reads the plus from the space-trimmed input only', () => {
    // A leading tab is not a space, so the plus is not at the start.
    expect(normalizePhoneDigits('\t+12')).toBe('12');
  });

  it('turns an input without digits into null', () => {
    expect(normalizePhoneDigits('abc')).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
  });
});

describe('normalizeVin', () => {
  it('folds digits, uppercases and keeps only letters and digits', () => {
    expect(normalizeVin(' 1hg-cm8\u0662 ')).toBe('1HGCM82');
  });

  it('repairs nothing: I, O and Q survive', () => {
    expect(normalizeVin('ioq')).toBe('IOQ');
  });

  it('turns an empty result into null', () => {
    expect(normalizeVin('--')).toBeNull();
    expect(normalizeVin(undefined)).toBeNull();
  });
});

describe('normalizePlate', () => {
  it('strips spaces and the dot, underscore and dash separators and uppercases', () => {
    expect(normalizePlate(' ab.12_3-4 ')).toBe('AB1234');
  });

  it('keeps non-Latin letters and folds digits', () => {
    expect(normalizePlate('\u0623 \u0661\u0662')).toBe('\u062312');
  });

  it('turns an empty result into null', () => {
    expect(normalizePlate(' - ')).toBeNull();
    expect(normalizePlate(null)).toBeNull();
  });
});
