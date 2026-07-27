/**
 * Exact-decimal boundary tests (Phase 1-20, P1-20-BE-014, P1-20-QA-001).
 *
 * These do not test "does arithmetic work" — the arithmetic is PostgreSQL's, and
 * the database suite proves that. They test the three things this type is
 * actually responsible for: that it refuses every input the protected columns
 * would refuse, that comparison is exact at the boundary, and that serialization
 * is deterministic and never a float.
 *
 * The drift test at the end is the one that matters most: it pins values that
 * IEEE-754 gets wrong, so a future "simplification" to `number` fails here rather
 * than in a customer's totals.
 */
import { describe, expect, it } from 'vitest';
import { types as pgTypes } from 'pg';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Decimal,
  DecimalError,
  MINUTES,
  MONEY,
  PERCENTAGE,
  QUANTITY,
  TAX_RATE,
  parseNonNegative,
  parsePositive,
} from '@/modules/pricing/domain/decimal';
import { CurrencyMismatchError, Money, moneyView } from '@/modules/pricing/domain/money';

describe('Decimal — parsing against the protected column specs', () => {
  it('accepts zero, and renders it at the column scale', () => {
    expect(Decimal.parse('0', MONEY).toString()).toBe('0.0000');
    expect(Decimal.zero(MONEY).toString()).toBe('0.0000');
    expect(Decimal.parse('0', TAX_RATE).toString()).toBe('0.000000');
  });

  it('accepts the minimum positive value at each scale', () => {
    expect(Decimal.parse('0.0001', MONEY).toString()).toBe('0.0001');
    expect(Decimal.parse('0.001', QUANTITY).toString()).toBe('0.001');
    expect(Decimal.parse('0.000001', TAX_RATE).toString()).toBe('0.000001');
    expect(Decimal.parse('0.01', MINUTES).toString()).toBe('0.01');
  });

  it('accepts the maximum value numeric(18,4) can hold', () => {
    const max = '99999999999999.9999'; // 14 whole + 4 fractional = 18 digits
    expect(Decimal.parse(max, MONEY).toString()).toBe(max);
  });

  it('rejects one digit more than the precision allows', () => {
    expect(() => Decimal.parse('999999999999999.9999', MONEY)).toThrow(DecimalError);
    expect(() => Decimal.parse('999999999999999.9999', MONEY)).toThrow(/19 digits.*holds 18/);
  });

  it('rejects excess scale rather than silently rounding it away', () => {
    expect(() => Decimal.parse('1.00001', MONEY)).toThrow(/5 decimal places.*holds 4/);
    expect(() => Decimal.parse('1.0001', QUANTITY)).toThrow(/4 decimal places.*holds 3/);
  });

  it('normalises trailing zeros within scale, because 1.50 and 1.5 are the same money', () => {
    expect(Decimal.parse('1.50', MONEY).toString()).toBe('1.5000');
    expect(Decimal.parse('1.5', MONEY).toString()).toBe('1.5000');
    expect(Decimal.parse('1.50', MONEY).equals(Decimal.parse('1.5', MONEY))).toBe(true);
  });

  it('rejects exponential notation outright', () => {
    for (const bad of ['1e3', '1E3', '1e-3', '1.5e2', '-1e3']) {
      expect(() => Decimal.parse(bad, MONEY)).toThrow(/not a plain decimal literal/);
    }
  });

  it('rejects the non-numeric inputs a probe would send', () => {
    for (const bad of [
      '',
      ' ',
      'NaN',
      'Infinity',
      '-Infinity',
      'abc',
      '1.2.3',
      '1,5',
      '+1',
      '.5',
      '1.',
      '0x10',
      '01',
    ]) {
      expect(() => Decimal.parse(bad, MONEY)).toThrow(DecimalError);
    }
  });

  it('rejects a non-string, so a JSON float cannot sneak in', () => {
    // A caller that sends `{"amount": 1.5}` produces a number here, not a string.
    expect(() => Decimal.parse(1.5 as unknown as string, MONEY)).toThrow(DecimalError);
    expect(() => Decimal.parse(null as unknown as string, MONEY)).toThrow(DecimalError);
  });

  it('accepts negatives at parse but refuses them where the column forbids one', () => {
    expect(Decimal.parse('-1.5', MONEY).toString()).toBe('-1.5000');
    expect(Decimal.parse('-1.5', MONEY).isNegative).toBe(true);
    expect(() => parseNonNegative('-0.0001', MONEY)).toThrow(/must not be negative/);
    expect(() => parsePositive('0', QUANTITY)).toThrow(/must be greater than zero/);
    expect(parsePositive('0.001', QUANTITY).toString()).toBe('0.001');
  });

  it('carries the percentage and tax-rate boundaries the CHECK constraints use', () => {
    // ck_discount_rules_type_value: percentage in 0..100
    expect(Decimal.parse('100', PERCENTAGE).toString()).toBe('100.0000');
    // ck_quotation_items_tax_rate: rate is a FRACTION in [0,1], not a percentage
    expect(Decimal.parse('1', TAX_RATE).toString()).toBe('1.000000');
    expect(Decimal.parse('0.16', TAX_RATE).toString()).toBe('0.160000');
    // 1.000001 still fits numeric(9,6); it is the DB CHECK, not the type, that caps it at 1
    expect(Decimal.parse('1.000001', TAX_RATE).toString()).toBe('1.000001');
  });
});

describe('Decimal — comparison is exact at the boundary', () => {
  it('orders values that differ only in the last representable digit', () => {
    const a = Decimal.parse('0.0001', MONEY);
    const b = Decimal.parse('0.0002', MONEY);
    expect(a.lessThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(true);
    expect(a.compare(a)).toBe(0);
  });

  it('compares across different scales by rescaling, not by truncating', () => {
    const money = Decimal.parse('0.5', MONEY); // scale 4
    const rate = Decimal.parse('0.5', TAX_RATE); // scale 6
    expect(money.equals(rate)).toBe(true);
    expect(money.compare(rate)).toBe(0);
  });

  it('compares large values without losing precision', () => {
    const a = Decimal.parse('99999999999999.9998', MONEY);
    const b = Decimal.parse('99999999999999.9999', MONEY);
    expect(a.lessThan(b)).toBe(true);
    expect(a.equals(b)).toBe(false);
  });
});

describe('Decimal — deterministic serialization', () => {
  it('always emits exactly the column scale, so equal values are byte-equal', () => {
    expect(Decimal.parse('7', MONEY).toString()).toBe('7.0000');
    expect(Decimal.parse('7.0', MONEY).toString()).toBe('7.0000');
    expect(Decimal.parse('7.0000', MONEY).toString()).toBe('7.0000');
  });

  it('serializes to a JSON STRING, never a number', () => {
    const encoded = JSON.stringify({ amount: Decimal.parse('1.5', MONEY) });
    expect(encoded).toBe('{"amount":"1.5000"}');
    expect(encoded).not.toContain('1.5,');
  });

  it('renders negatives with the sign outside the padding', () => {
    expect(Decimal.parse('-0.0001', MONEY).toString()).toBe('-0.0001');
    expect(Decimal.parse('-12.5', MONEY).toString()).toBe('-12.5000');
  });
});

describe('Decimal — no binary floating-point drift', () => {
  /**
   * Each pair is a value IEEE-754 cannot hold exactly. If this type ever routes
   * through `number`, the round-trip changes the string and these fail.
   */
  it.each([
    ['0.1', '0.1000'],
    ['0.2', '0.2000'],
    ['0.3', '0.3000'],
    ['1.005', '1.0050'],
    ['2.675', '2.6750'],
    ['4.345', '4.3450'],
    ['1234567890.1234', '1234567890.1234'],
    ['99999999999999.9999', '99999999999999.9999'],
  ])('round-trips %s exactly', (input, expected) => {
    expect(Decimal.parse(input, MONEY).toString()).toBe(expected);
  });

  it('does not equate values that a double would collapse together', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. At scale 4 the exact
    // representation keeps 0.3000 distinct from 0.3001.
    const threeTenths = Decimal.parse('0.3', MONEY);
    const nudged = Decimal.parse('0.3001', MONEY);
    expect(threeTenths.equals(nudged)).toBe(false);
    expect(threeTenths.lessThan(nudged)).toBe(true);
  });

  it('keeps 17-significant-digit values distinct, which a double cannot', () => {
    const a = Decimal.parse('10000000000000.0001', MONEY);
    const b = Decimal.parse('10000000000000.0002', MONEY);
    // Number(a) === Number(b) would be true here.
    expect(Number(a.toString()) === Number(b.toString())).toBe(true);
    expect(a.equals(b)).toBe(false);
  });
});

describe('Money — currency is part of the value', () => {
  it('validates the ISO 4217 shape without any hard-coded currency', () => {
    expect(Money.of('10.00', 'JOD').toJSON()).toEqual({ amount: '10.0000', currency: 'JOD' });
    expect(Money.of('10.00', 'USD').toJSON()).toEqual({ amount: '10.0000', currency: 'USD' });
    expect(Money.of('10.00', 'EUR').currency).toBe('EUR');
    for (const bad of ['jod', 'JO', 'JODX', '', '123']) {
      expect(() => Money.of('1', bad)).toThrow(/three-letter ISO 4217/);
    }
  });

  it('refuses to compare across currencies, naming the context', () => {
    const jod = Money.of('10.00', 'JOD');
    const usd = Money.of('10.00', 'USD');
    expect(() => jod.compare(usd, 'quotation line 3')).toThrow(CurrencyMismatchError);
    expect(() => jod.compare(usd, 'quotation line 3')).toThrow(/quotation line 3.*USD.*JOD/);
  });

  it('compares equal amounts in the same currency', () => {
    expect(Money.of('10.00', 'JOD').compare(Money.of('10.0000', 'JOD'), 'x')).toBe(0);
    expect(Money.of('10.01', 'JOD').greaterThan(Money.of('10.00', 'JOD'), 'x')).toBe(true);
  });

  it('exposes no conversion path at all, so silent FX is unexpressible', () => {
    const money = Money.of('1', 'JOD') as unknown as Record<string, unknown>;
    for (const forbidden of ['convert', 'to', 'in', 'exchange', 'add', 'multiply', 'plus']) {
      expect(typeof money[forbidden]).toBe('undefined');
    }
  });

  it('renders a stored value through moneyView as a string pair', () => {
    expect(moneyView('1234.5000', 'JOD')).toEqual({ amount: '1234.5000', currency: 'JOD' });
  });
});

/**
 * The driver-level assumption every money read in this phase rests on.
 *
 * `numeric` is OID 1700, and node-postgres returns it as a **string** by default.
 * That is the entire reason a `numeric(18,4)` can round-trip through this codebase
 * without ever becoming a float. It is a default, not a guarantee: one
 * `pg.types.setTypeParser(1700, parseFloat)` anywhere in the process — a plausible
 * "convenience" for a reporting query — would silently turn every uncast money column
 * into an IEEE-754 double, and `99999999999999.9999` would come back as
 * `100000000000000`. No test would fail, because every assertion on money in this
 * repository compares strings that would then be numbers.
 *
 * Two defences, and this is the second one. First: every money column is selected with
 * an explicit `::text` cast, so the parser is not consulted at all. Second: this test,
 * which fails the moment the default changes — because the casts are a convention a
 * future author can forget, and the default is what protects them until they remember.
 */
const SRC = join(process.cwd(), 'src');

/** Every .ts file's text under a directory, for a structural source assertion. */
function collectSql(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSql(full));
    else if (entry.endsWith('.ts')) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

describe('the pg numeric type parser is not overridden', () => {
  it('returns numeric (OID 1700) as a string, not a number', () => {
    // 1700 = numeric/decimal. `getTypeParser` returns the function that will be applied
    // to the wire value, so this asserts the behaviour rather than the registration.
    const parse = pgTypes.getTypeParser(1700) as (value: string) => unknown;
    const parsed = parse('99999999999999.9999');
    expect(typeof parsed).toBe('string');
    expect(parsed).toBe('99999999999999.9999');
  });

  it('records that numeric ARRAYS (OID 1231) are parsed as FLOATS, and that this phase never selects one', () => {
    /**
     * A genuine driver hazard, pinned rather than assumed away.
     *
     * Unlike the scalar, node-postgres parses `numeric[]` **elements** into JS numbers.
     * So `SELECT array_agg(amount)` would hand back doubles no matter how carefully the
     * scalar path is written — the `::text` convention on a column says nothing about an
     * aggregate that leaves the database as an array.
     *
     * This phase does not select a numeric array anywhere, and the second assertion is
     * what keeps that true: if a future query aggregates money into an array, this fails
     * and points at the reason.
     */
    // 1231 is numeric[]; the typings enumerate only scalar OIDs, so the cast is on the
    // OID rather than on the result.
    const parse = pgTypes.getTypeParser(
      1231 as unknown as Parameters<typeof pgTypes.getTypeParser>[0]
    ) as (value: string) => unknown;
    const parsed = parse('{1.0001,2.0002}') as unknown[];
    expect(parsed.every((element) => typeof element === 'number')).toBe(true);

    const moduleSql = ['pricing', 'quotation', 'service-catalog']
      .flatMap((name) => collectSql(join(SRC, 'modules', name)))
      .join('\n');
    expect(moduleSql).not.toMatch(/array_agg\s*\(/i);
    expect(moduleSql).not.toMatch(/numeric\s*\[\s*\]/i);
  });
});
