/**
 * P1-32 text folding — SQL against the hand-written fixture table, and SQL
 * against the TypeScript mirrors (P1-32-PRE-050, P1-32-PRE-051).
 *
 * The unit tier proves the mirrors produce the expected values. This tier proves
 * the DATABASE does too, over the same table, and that the two implementations
 * agree row by row — which is the only honest way to prove parity, because a
 * mirror that disagrees with the database produces a lookup key that finds
 * nothing while looking correct.
 *
 * It also proves the two consequences of the migration that no function-level
 * test can see:
 *
 *  - the STORED generated columns (`vin_normalized`, `plate_normalized`) are
 *    computed with the folded rule, so a VIN or plate typed with Arabic-Indic
 *    digits is stored under the same key as its ASCII spelling — and the
 *    cross-vehicle active-plate exclusion therefore treats the two spellings as
 *    the SAME plate;
 *  - the search indexes exist with the expressions the repositories query, so
 *    the widened search is index-eligible rather than silently a scan.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  withRolledBackTx,
  TENANT_A,
  USER_A,
} from './helpers';
import {
  foldDigits,
  foldSearchText,
  normalizePhoneDigits,
  normalizePlate,
  normalizeVin,
} from '@api/shared/text/normalization';
import { TEXT_FOLDING_CASES } from '../foundation/text-folding-fixtures';

let admin: Pool;
let runtime: Pool;

const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

interface FoldedRow {
  readonly ordinal: number;
  readonly fold_digits: string | null;
  readonly fold_search_text: string | null;
  readonly normalize_name: string | null;
  readonly normalize_phone: string | null;
  readonly normalize_vin: string | null;
  readonly normalize_plate: string | null;
}

describe('P1-32 / the SQL folding functions against the fixture table', () => {
  it('every function answers every row exactly as written, and exactly as the mirror does', async () => {
    const inputs = TEXT_FOLDING_CASES.map((row) => row.input);
    // Run as the RUNTIME role, not admin: the grants are part of the contract, and
    // a function only the superuser could execute would pass an admin-run test.
    await withRolledBackTx(runtime, ctxA, async (client) => {
      const { rows } = await client.query<FoldedRow>(
        `SELECT u.ordinal::int AS ordinal,
                shared.fold_digits(u.input)      AS fold_digits,
                shared.fold_search_text(u.input) AS fold_search_text,
                crm.normalize_name(u.input)      AS normalize_name,
                crm.normalize_phone(u.input)     AS normalize_phone,
                veh.normalize_vin(u.input)       AS normalize_vin,
                veh.normalize_plate(u.input)     AS normalize_plate
           FROM unnest($1::text[]) WITH ORDINALITY AS u(input, ordinal)
          ORDER BY u.ordinal`,
        [inputs]
      );
      expect(rows).toHaveLength(TEXT_FOLDING_CASES.length);
      for (const row of rows) {
        const fixture = TEXT_FOLDING_CASES[row.ordinal - 1];
        if (fixture === undefined) throw new Error(`no fixture for ordinal ${row.ordinal}`);
        const where = JSON.stringify(fixture.label);

        expect(row.fold_digits, `fold_digits ${where}`).toBe(fixture.foldDigits);
        expect(row.fold_search_text, `fold_search_text ${where}`).toBe(fixture.foldSearchText);
        // crm.normalize_name is now one line over the name rule.
        expect(row.normalize_name, `normalize_name ${where}`).toBe(fixture.foldSearchText);
        expect(row.normalize_phone, `normalize_phone ${where}`).toBe(fixture.phone);
        expect(row.normalize_vin, `normalize_vin ${where}`).toBe(fixture.vin);
        expect(row.normalize_plate, `normalize_plate ${where}`).toBe(fixture.plate);

        // And the mirrors, compared to the DATABASE rather than to the fixture, so a
        // fixture typo cannot make the two implementations look like they agree.
        expect(foldDigits(fixture.input), `mirror foldDigits ${where}`).toBe(row.fold_digits);
        expect(foldSearchText(fixture.input), `mirror foldSearchText ${where}`).toBe(
          row.fold_search_text
        );
        expect(normalizePhoneDigits(fixture.input), `mirror phone ${where}`).toBe(
          row.normalize_phone
        );
        expect(normalizeVin(fixture.input), `mirror vin ${where}`).toBe(row.normalize_vin);
        expect(normalizePlate(fixture.input), `mirror plate ${where}`).toBe(row.normalize_plate);
      }
    });
  });

  it('shared.fold_digits is STRICT: NULL stays NULL rather than becoming an empty string', async () => {
    const { rows } = await admin.query<{ folded: string | null }>(
      `SELECT shared.fold_digits(NULL) AS folded`
    );
    expect(rows[0]?.folded).toBeNull();
  });

  it('both new functions are IMMUTABLE, SECURITY INVOKER, pinned search_path, and not PUBLIC', async () => {
    const { rows } = await admin.query<{
      proname: string;
      provolatile: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      public_execute: boolean;
    }>(
      `SELECT p.proname, p.provolatile, p.prosecdef, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared' AND p.proname IN ('fold_digits', 'fold_search_text')
        ORDER BY p.proname`
    );
    expect(rows.map((r) => r.proname)).toEqual(['fold_digits', 'fold_search_text']);
    for (const row of rows) {
      expect(row.provolatile, row.proname).toBe('i');
      expect(row.prosecdef, row.proname).toBe(false);
      expect(row.proconfig ?? [], row.proname).toContain('search_path=""');
      expect(row.public_execute, row.proname).toBe(false);
    }
  });
});

describe('P1-32 / stored generated columns are computed with the folded rule', () => {
  it('a VIN and a plate written with Arabic-Indic digits are stored under their ASCII key', async () => {
    await withRolledBackTx(runtime, ctxA, async (client) => {
      const vehicle = await client.query<{ id: string; vin_normalized: string | null }>(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, created_by)
         VALUES ($1, $2, 'ice', $3)
         RETURNING id, vin_normalized`,
        [TENANT_A, 'odsrch-\u0661\u0662\u0663\u0664\u0665\u0666\u0667', USER_A]
      );
      expect(vehicle.rows[0]?.vin_normalized).toBe('ODSRCH1234567');

      const plate = await client.query<{ plate_normalized: string }>(
        `INSERT INTO veh.plate_history
           (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
         VALUES ($1, $2, 'JO', $3, DATE '2026-01-01', $4)
         RETURNING plate_normalized`,
        [TENANT_A, vehicle.rows[0]?.id, '\u0661\u0662-\u0663\u0664\u0665 \u0623', USER_A]
      );
      expect(plate.rows[0]?.plate_normalized).toBe('12345\u0623');
    });
  });

  it('the active-plate exclusion treats the Arabic-Indic and ASCII spellings as ONE plate', async () => {
    // Before the migration these two stored different keys, so the same physical
    // plate could be active on two vehicles at once. Now the second insert must be
    // refused by ex_plate_history_active_plate.
    await withRolledBackTx(runtime, ctxA, async (client) => {
      const vehicles = await client.query<{ id: string }>(
        `INSERT INTO veh.vehicles (tenant_id, powertrain_category, created_by)
         VALUES ($1, 'ice', $2), ($1, 'ice', $2)
         RETURNING id`,
        [TENANT_A, USER_A]
      );
      const [first, second] = vehicles.rows;
      await client.query(
        `INSERT INTO veh.plate_history
           (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
         VALUES ($1, $2, 'JO', 'ODS 4821', DATE '2026-01-01', $3)`,
        [TENANT_A, first?.id, USER_A]
      );
      await expectSqlState(
        client.query(
          `INSERT INTO veh.plate_history
             (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
           VALUES ($1, $2, 'JO', $3, DATE '2026-01-01', $4)`,
          [TENANT_A, second?.id, 'ODS \u0664\u0668\u0662\u0661', USER_A]
        ),
        '23P01'
      );
    });
  });
});

describe('P1-32 / the search indexes exist with the expressions the repositories query', () => {
  const EXPECTED: readonly { name: string; table: string; fragment: RegExp }[] = [
    {
      name: 'ix_business_partners_name_folded_trgm',
      table: 'business_partners',
      fragment: /USING gin \(crm\.normalize_name\(display_name\) (?:extensions\.)?gin_trgm_ops\)/,
    },
    {
      name: 'ix_contact_points_phone_tail',
      table: 'contact_points',
      fragment: /\(tenant_id, "right"\(normalized_value, 7\)\)/,
    },
    {
      name: 'ix_vehicles_vin_trgm',
      table: 'vehicles',
      fragment: /USING gin \(vin_normalized (?:extensions\.)?gin_trgm_ops\)/,
    },
    {
      name: 'ix_plate_history_normalized_trgm',
      table: 'plate_history',
      fragment: /USING gin \(plate_normalized (?:extensions\.)?gin_trgm_ops\)/,
    },
    {
      name: 'ix_makes_name_folded_trgm',
      table: 'makes',
      fragment: /USING gin \(shared\.fold_search_text\(name\) (?:extensions\.)?gin_trgm_ops\)/,
    },
    {
      name: 'ix_models_name_folded_trgm',
      table: 'models',
      fragment: /USING gin \(shared\.fold_search_text\(name\) (?:extensions\.)?gin_trgm_ops\)/,
    },
    {
      name: 'ix_work_orders_display_number_trgm',
      table: 'work_orders',
      fragment: /USING gin \(display_number (?:extensions\.)?gin_trgm_ops\)/,
    },
  ];

  it('every index is present on its table with its expression', async () => {
    const { rows } = await admin.query<{ indexname: string; tablename: string; indexdef: string }>(
      `SELECT indexname, tablename, indexdef FROM pg_indexes WHERE indexname = ANY($1::text[])`,
      [EXPECTED.map((index) => index.name)]
    );
    expect(rows).toHaveLength(EXPECTED.length);
    for (const expected of EXPECTED) {
      const row = rows.find((candidate) => candidate.indexname === expected.name);
      expect(row?.tablename, expected.name).toBe(expected.table);
      expect(row?.indexdef ?? '', expected.name).toMatch(expected.fragment);
    }
  });

  it('the planner has a trigram index path for a folded name CONTAINS', async () => {
    // What this proves is REACHABILITY, not preference. On an empty table the
    // planner rightly prefers any cheap path, so every non-bitmap path is switched
    // off for this one transaction and the tenant predicate is left out: the only
    // index that can then serve the LIKE at all is the trigram one. A CONTAINS with
    // no usable index would plan a (disabled-cost) scan instead.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_indexscan = off');
      await client.query('SET LOCAL enable_indexonlyscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM crm.business_partners
          WHERE deleted_at IS NULL
            AND crm.normalize_name(display_name) LIKE '%odsrch%'`
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('Bitmap Index Scan on ix_business_partners_name_folded_trgm');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
