import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareMoney,
  formatMoney,
  isCanonicalMoney,
  isNegativeMoney,
  isZeroMoney,
  parseMoneyInput,
  toCanonicalMoney,
  trimTrailingZeros,
} from '../src/lib/money';

/**
 * Money is where a rounding error becomes a wrong invoice, so these cases are
 * about exactness rather than about the happy path.
 */

describe('canonicalisation is string work, not arithmetic', () => {
  it.each([
    ['0', '0.0000'],
    ['12', '12.0000'],
    ['12.5', '12.5000'],
    ['12.50', '12.5000'],
    ['12.5000', '12.5000'],
    ['0.0001', '0.0001'],
    ['-45.25', '-45.2500'],
    ['007', '7.0000'],
    ['  19.99  ', '19.9900'],
  ])('canonicalises %s to %s', (input, expected) => {
    expect(parseMoneyInput(input).canonical).toBe(expected);
  });

  it('preserves the fourth decimal place, which a double would lose', () => {
    // The exact value the backend's numeric(18,4) stores. Number('100.9500')
    // is 100.95 and the trailing precision is gone with no way to detect it.
    expect(toCanonicalMoney('100.9500')).toBe('100.9500');
    expect(toCanonicalMoney('0.0001')).toBe('0.0001');
    expect(toCanonicalMoney('99999999999999.9999')).toBe('99999999999999.9999');
  });

  it('keeps the widest amount the column allows exact', () => {
    // numeric(18,4) is 14 integer digits plus 4 decimals — 18 significant
    // digits, which is MORE than a double carries (15–17). These two values
    // are distinct here and identical once either has been through Number().
    expect(toCanonicalMoney('99999999999999.9999')).toBe('99999999999999.9999');
    expect(toCanonicalMoney('99999999999999.9998')).toBe('99999999999999.9998');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-decimal'],
    ['1,250.00', 'not-decimal'],
    ['1e5', 'not-decimal'],
    ['١٢٣', 'not-decimal'],
    ['12.', 'not-decimal'],
    ['.5', 'not-decimal'],
    ['12.00001', 'too-many-decimals'],
    ['-0.0000', 'negative-zero'],
    ['-0', 'negative-zero'],
  ])('refuses %s as %s', (input, problem) => {
    const result = parseMoneyInput(input);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe(problem);
  });

  it('refuses more digits than numeric(18,4) can hold', () => {
    expect(parseMoneyInput('123456789012345.00').problem).toBe('too-many-digits');
  });

  it('recognises its own canonical form', () => {
    expect(isCanonicalMoney('12.5000')).toBe(true);
    expect(isCanonicalMoney('12.5')).toBe(false);
    expect(isCanonicalMoney('012.5000')).toBe(false);
  });
});

describe('comparison works on digits', () => {
  it('orders values a float comparison would also get right', () => {
    expect(compareMoney('1.0000', '2.0000')).toBe(-1);
    expect(compareMoney('2.0000', '1.0000')).toBe(1);
    expect(compareMoney('2.0000', '2.0000')).toBe(0);
  });

  it('orders values a float comparison gets WRONG', () => {
    // 18 significant digits. As doubles these two collapse to the same value,
    // so a numeric comparison reports 0 and the sort silently loses an order
    // that the database considers strict.
    const high = '99999999999999.9999';
    const low = '99999999999999.9998';
    expect(compareMoney(high, low)).toBe(1);
    expect(compareMoney(low, high)).toBe(-1);
    expect(globalThis.Number(high) === globalThis.Number(low), 'the premise').toBe(true);
  });

  it('orders negatives by magnitude correctly', () => {
    expect(compareMoney('-5.0000', '-2.0000')).toBe(-1);
    expect(compareMoney('-2.0000', '-5.0000')).toBe(1);
    expect(compareMoney('-1.0000', '1.0000')).toBe(-1);
  });

  it('compares across differing whole-part widths', () => {
    expect(compareMoney('9.9999', '10.0000')).toBe(-1);
    expect(compareMoney('100.0000', '99.9999')).toBe(1);
  });

  it('identifies zero and negative', () => {
    expect(isZeroMoney('0.0000')).toBe(true);
    expect(isZeroMoney('0.0001')).toBe(false);
    expect(isNegativeMoney('-0.0001')).toBe(true);
    expect(isNegativeMoney('0.0000')).toBe(false);
  });
});

describe('formatting is display only', () => {
  it('shows the ISO code rather than an ambiguous symbol', () => {
    // A multi-company tenant can hold JOD and USD in one table, and `$` names
    // at least a dozen currencies.
    expect(formatMoney({ amount: '1250.0000', currency: 'JOD' }, 'en-GB')).toContain('JOD');
    expect(formatMoney({ amount: '1250.0000', currency: 'USD' }, 'en-GB')).toContain('USD');
  });

  it('groups thousands for a human', () => {
    expect(formatMoney({ amount: '1234567.8900', currency: 'JOD' }, 'en-GB')).toBe(
      '1,234,567.89 JOD'
    );
  });

  it('uses Latin digits for Arabic, matching workshop paperwork', () => {
    const arabic = formatMoney({ amount: '1250.0000', currency: 'JOD' }, 'ar-JO-u-nu-latn');
    expect(arabic).toMatch(/1.?250/);
    expect(arabic).not.toMatch(/[٠-٩]/);
  });

  it('canonicalises a short form but refuses a non-decimal one', () => {
    // '12.5' is a legitimate shorthand and is padded. 'abc' is not an amount at
    // all, and formatting it as 0 or NaN would put a wrong number on a screen
    // that looks exactly like a right one.
    expect(formatMoney({ amount: '12.5', currency: 'JOD' }, 'en-GB')).toBe('12.50 JOD');
    expect(() => formatMoney({ amount: 'abc', currency: 'JOD' }, 'en-GB')).toThrow();
    expect(() => formatMoney({ amount: '', currency: 'JOD' }, 'en-GB')).toThrow();
    expect(() => formatMoney({ amount: '1,250', currency: 'JOD' }, 'en-GB')).toThrow();
  });

  it('trims trailing zeros without arithmetic', () => {
    expect(trimTrailingZeros('12.5000')).toBe('12.5');
    expect(trimTrailingZeros('12.0000')).toBe('12');
    expect(trimTrailingZeros('0.0000')).toBe('0');
    expect(trimTrailingZeros('-45.2500')).toBe('-45.25');
  });
});

describe('the module contains no floating-point arithmetic', () => {
  // A structural assertion, because the rule is easy to break in a way that
  // passes every behavioural test above: one `Number()` in a helper added later
  // would round correctly for the values these cases happen to use.
  const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'money.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

  it('calls Number() exactly once, inside the display helper', () => {
    const calls = code.match(/\bNumber\s*\(/g) ?? [];
    const qualified = code.match(/globalThis\.Number\s*\(/g) ?? [];
    expect(calls.length, 'every Number() must be the one in displayNumber').toBe(1);
    expect(qualified.length, 'and it must be explicitly qualified so it is greppable').toBe(1);
  });

  it('never calls parseFloat, parseInt or toFixed', () => {
    expect(code).not.toMatch(/\bparseFloat\s*\(/);
    expect(code).not.toMatch(/\bparseInt\s*\(/);
    expect(code).not.toMatch(/\.toFixed\s*\(/);
  });

  it('performs no multiplication or division on an amount', () => {
    // Scaling by 10^n is the tempting shortcut and it is exactly what loses
    // precision. Padding is done with padEnd on the string instead.
    expect(code).not.toMatch(/\*\s*10/);
    expect(code).not.toMatch(/\/\s*10/);
  });
});
