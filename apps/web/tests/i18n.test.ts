import { describe, expect, it } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { DEFAULT_LOCALE, DIRECTION, LOCALES, directionOf, isLocale } from '../src/i18n/config';

/**
 * Translation completeness, as a gate rather than a review habit.
 *
 * `translate` returns the KEY when a message is missing, which makes a gap
 * visible in the interface instead of rendering nothing. These tests are what
 * turn that visibility into a build failure — a visible gap that ships is still
 * a gap that shipped.
 */

const EN_KEYS = Object.keys(en).sort();
const AR_KEYS = Object.keys(ar).sort();

describe('locale configuration', () => {
  it('lists Arabic first, because RTL is not the exception here', () => {
    expect(LOCALES[0]).toBe('ar');
    expect(DEFAULT_LOCALE).toBe('ar');
  });

  it('assigns a direction to every locale', () => {
    for (const locale of LOCALES) {
      expect(['rtl', 'ltr']).toContain(DIRECTION[locale]);
      expect(directionOf(locale)).toBe(DIRECTION[locale]);
    }
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('rejects a locale it does not serve', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    for (const value of ['fr', 'AR', 'en-GB', '', '../en']) {
      expect(isLocale(value), value).toBe(false);
    }
  });
});

describe('message catalogues', () => {
  it('is not empty, so the comparisons below are not vacuous', () => {
    expect(EN_KEYS.length).toBeGreaterThan(40);
  });

  it('defines exactly the same keys in both languages', () => {
    const missingInArabic = EN_KEYS.filter((key) => !AR_KEYS.includes(key));
    const missingInEnglish = AR_KEYS.filter((key) => !EN_KEYS.includes(key));
    expect(missingInArabic, 'keys present in en and missing from ar').toEqual([]);
    expect(missingInEnglish, 'keys present in ar and missing from en').toEqual([]);
  });

  it('has no empty or whitespace-only message', () => {
    for (const [catalogue, name] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(typeof value, `${name}.${key}`).toBe('string');
        expect(String(value).trim().length, `${name}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('has no Arabic message left in English', () => {
    // The failure this catches is a copy-paste that leaves the English string in
    // the Arabic file, which reads as "translated" to anyone who does not read
    // Arabic and is invisible to a key-completeness check.
    const arabicScript = /[؀-ۿ]/;
    const untranslated = Object.entries(ar)
      .filter(([key, value]) => {
        // Keys whose value is legitimately identical or non-linguistic are
        // exempted explicitly rather than by a heuristic.
        if (key === 'state.correlationId') return false;
        return !arabicScript.test(String(value));
      })
      .map(([key]) => key);
    expect(untranslated, 'Arabic entries containing no Arabic script').toEqual([]);
  });

  it('uses dotted namespaces so a key names its owner', () => {
    for (const key of EN_KEYS) {
      expect(key, `${key} has no namespace`).toMatch(/^[a-z][a-zA-Z]*\./);
    }
  });
});
