/**
 * P1-15 normalization parity with the frozen database functions.
 *
 * The TypeScript normalizers in `@/modules/shared-services` exist so a request can
 * be validated and a lookup key built without a database round trip. That is only
 * safe if they agree with the database **exactly** — a mirror that disagrees is
 * worse than no mirror, because it produces a key that finds nothing while looking
 * correct.
 *
 * This suite is therefore differential, not example-based: the same corpus goes
 * through `veh.normalize_vin`, `crm.normalize_phone` and `crm.normalize_email` and
 * through the TypeScript implementations, and every pair must match. The corpus
 * deliberately includes the edge cases that look like defects — a lone `'+'`,
 * Arabic-Indic digits, `I`/`O`/`Q` in a VIN, and `+tag` in an email — because
 * those are exactly the places a well-meaning reimplementation diverges.
 *
 * Read as evidence: this proves the mirrors are faithful. It does **not** claim the
 * frozen semantics are ideal; where they are surprising, the surprise is recorded
 * in docs/phase-1/phase-1-15/phase-1-15-implementation-decisions.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';
import {
  normalizeEmail,
  normalizePhoneDigits,
  normalizeVin,
} from '@/modules/shared-services/domain/normalization';

let admin: Pool;

beforeAll(() => {
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

/**
 * One corpus for all three normalizers. Anything that is meaningful for one kind
 * is harmless for the others, and sharing it means a value can never be tested
 * against one implementation but not the other.
 */
const CORPUS: readonly string[] = [
  '',
  ' ',
  '   ',
  '+',
  ' + ',
  '++',
  '0',
  'wp0zzz98s1k303',
  '  wp0zzz9 8s1k303 ',
  'WP0ZZZ98S1K303',
  'wp0-zzz9/8s1k303',
  'iooq1234567890abc',
  'IOOQ1234567890ABC',
  '1HGBH41JXMN109186',
  'jh4-tb2h26cc000000',
  '+962 7 9012 3456',
  '+962790123456',
  '0790123456',
  '(079) 012-3456',
  '00962790123456',
  ' +962-79-012-3456 ',
  '٠٧٩٠١٢٣٤٥٦',
  '٠٧٩ 0123',
  'A.B+Tag@X.COM',
  '  A.B+Tag@X.COM  ',
  'first.last+inbox@example.test',
  'MiXeD@Example.TEST',
  'محمد',
  'مُحَمَّد',
  'Ali Al-Bitar',
  '  Ali   Al-Bitar  ',
  'tab\tseparated',
  'new\nline',
  'null-ish',
  '٣٫١٤',
  'ＦＵＬＬＷＩＤＴＨ',
];

describe('P1-15 / normalization parity with the frozen SQL', () => {
  it('normalizeVin matches veh.normalize_vin for every corpus value', async () => {
    const { rows } = await admin.query<{ input: string; sql: string | null }>(
      `SELECT u.input, veh.normalize_vin(u.input) AS sql
         FROM unnest($1::text[]) AS u(input)`,
      [CORPUS as string[]]
    );
    expect(rows).toHaveLength(CORPUS.length);
    for (const row of rows) {
      expect(
        normalizeVin(row.input).normalized,
        `VIN mismatch for ${JSON.stringify(row.input)}`
      ).toBe(row.sql);
    }
  });

  it('normalizePhoneDigits matches crm.normalize_phone for every corpus value', async () => {
    const { rows } = await admin.query<{ input: string; sql: string | null }>(
      `SELECT u.input, crm.normalize_phone(u.input) AS sql
         FROM unnest($1::text[]) AS u(input)`,
      [CORPUS as string[]]
    );
    expect(rows).toHaveLength(CORPUS.length);
    for (const row of rows) {
      expect(
        normalizePhoneDigits(row.input),
        `phone mismatch for ${JSON.stringify(row.input)}`
      ).toBe(row.sql);
    }
  });

  it('normalizeEmail matches crm.normalize_email for every corpus value', async () => {
    const { rows } = await admin.query<{ input: string; sql: string | null }>(
      `SELECT u.input, crm.normalize_email(u.input) AS sql
         FROM unnest($1::text[]) AS u(input)`,
      [CORPUS as string[]]
    );
    expect(rows).toHaveLength(CORPUS.length);
    for (const row of rows) {
      expect(normalizeEmail(row.input), `email mismatch for ${JSON.stringify(row.input)}`).toBe(
        row.sql
      );
    }
  });

  // The four behaviours most likely to be "helpfully" broken by a future edit.
  // Each is pinned against the database in the same assertion, so a divergence
  // fails here rather than silently in production lookup keys.

  it('a lone plus survives phone normalization in both implementations', async () => {
    const { rows } = await admin.query<{ sql: string | null }>(
      `SELECT crm.normalize_phone('+') AS sql`
    );
    expect(rows[0]?.sql).toBe('+');
    expect(normalizePhoneDigits('+')).toBe('+');
  });

  it('Arabic-Indic digits normalize away in both implementations', async () => {
    const { rows } = await admin.query<{ sql: string | null }>(
      `SELECT crm.normalize_phone('٠٧٩٠١٢٣٤٥٦') AS sql`
    );
    expect(rows[0]?.sql).toBeNull();
    expect(normalizePhoneDigits('٠٧٩٠١٢٣٤٥٦')).toBeNull();
  });

  it('VIN keeps I, O and Q in both implementations', async () => {
    const { rows } = await admin.query<{ sql: string | null }>(
      `SELECT veh.normalize_vin('iooq1234567890abc') AS sql`
    );
    expect(rows[0]?.sql).toBe('IOOQ1234567890ABC');
    expect(normalizeVin('iooq1234567890abc').normalized).toBe('IOOQ1234567890ABC');
  });

  it('email keeps dots and plus tags in both implementations', async () => {
    const { rows } = await admin.query<{ sql: string | null }>(
      `SELECT crm.normalize_email('  A.B+Tag@X.COM  ') AS sql`
    );
    expect(rows[0]?.sql).toBe('a.b+tag@x.com');
    expect(normalizeEmail('  A.B+Tag@X.COM  ')).toBe('a.b+tag@x.com');
  });

  it('an implausible VIN is reported, never repaired', () => {
    const result = normalizeVin('iooq1234567890abc');
    // Normalization is unchanged...
    expect(result.normalized).toBe('IOOQ1234567890ABC');
    // ...and the judgement is delivered alongside it.
    expect(result.plausible).toBe(false);
    expect(result.reasons).toContain('contains-i-o-q');
  });
});
