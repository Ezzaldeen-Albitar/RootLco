import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ODOMETER_ANOMALY_REASONS,
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  OWNERSHIP_KINDS,
  correctionChoices,
  intervalState,
  isCorrection,
  isInForceOn,
  localToday,
  odometerDisplay,
  type OdometerReadingEntry,
} from '@/features/vehicles/history-contract';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * Vehicle ownership (`FE-021`), plates (`FE-022`) and odometer (`FE-023`).
 *
 * Three traps, and they are the whole substance of this wave:
 *   1. a `date` parsed through `new Date()` shifts the day,
 *   2. a `numeric` parsed through a float loses the precision it was cast to
 *      text to preserve,
 *   3. `active` means "not closed", not "in force today".
 */

const client = { get: vi.fn() };
const authorizedClient = vi.fn(async () => client as unknown);
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: () => authorizedClient() }));

const { listOwnerships, listPlates, listOdometerReadings } =
  await import('@/features/vehicles/history-api');

const REQUEST = { pageSize: 25 } as never;

beforeEach(() => {
  client.get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the six operations resolve, and only the writes need a key', () => {
  it('resolves all three history reads', () => {
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/ownerships')?.operationId).toBe(
      'veh.vehicle-ownership-history'
    );
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/plates')?.operationId).toBe(
      'veh.vehicle-plate-history'
    );
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/odometer-readings')?.operationId).toBe(
      'veh.vehicle-odometer-history'
    );
  });

  it('requires a key on the three writes and on none of the reads', () => {
    for (const segment of ['ownerships', 'plates', 'odometer-readings']) {
      const path = `/api/v1/vehicles/v1/${segment}`;
      expect(requiresIdempotencyKey('POST', path), segment).toBe(true);
      expect(requiresIdempotencyKey('GET', path), segment).toBe(false);
    }
  });
});

describe('a date is never converted, in either direction', () => {
  it('compares ISO days as strings, which is exactly chronological order', () => {
    // `YYYY-MM-DD` sorts lexicographically in the same order it sorts
    // chronologically, so `<=` on strings needs no Date and cannot shift a day.
    expect(isInForceOn({ validFrom: '2026-01-01', validTo: null }, '2026-08-04')).toBe(true);
    expect(isInForceOn({ validFrom: '2026-09-01', validTo: null }, '2026-08-04')).toBe(false);
    expect(isInForceOn({ validFrom: '2026-01-01', validTo: '2026-08-04' }, '2026-08-04')).toBe(
      false
    );
    expect(isInForceOn({ validFrom: '2026-01-01', validTo: '2026-08-05' }, '2026-08-04')).toBe(
      true
    );
  });

  it('builds today from LOCAL parts, not from toISOString', () => {
    // 2026-08-04 at 23:30 local. `toISOString().slice(0, 10)` would give
    // 2026-08-04 in UTC+0 but 2026-08-05 for anyone east of Greenwich — and
    // "is this plate in force today" would answer for the wrong day.
    const localLate = new Date(2026, 7, 4, 23, 30, 0);
    expect(localToday(localLate)).toBe('2026-08-04');

    const localEarly = new Date(2026, 7, 4, 0, 30, 0);
    expect(localToday(localEarly)).toBe('2026-08-04');
  });

  it('pads single-digit months and days', () => {
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('active is NOT "in force today"', () => {
  const openEnded = { validFrom: '2026-01-01', validTo: null, active: true };

  it('reports a future-dated open interval as SCHEDULED, not in force', () => {
    // The trap. `active` is `valid_to IS NULL`, so a plate assigned with a
    // future start reports active before it is in force, and a screen that
    // labelled it "current" would be wrong for exactly that interval.
    const future = { validFrom: '2026-12-01', validTo: null, active: true };
    expect(future.active).toBe(true);
    expect(intervalState(future, '2026-08-04')).toBe('scheduled');
    expect(intervalState(future, '2026-08-04')).not.toBe('in-force');
  });

  it('reports a started open interval as in force', () => {
    expect(intervalState(openEnded, '2026-08-04')).toBe('in-force');
  });

  it('reports a closed interval as ended, even though active is false', () => {
    expect(
      intervalState({ validFrom: '2026-01-01', validTo: '2026-06-01', active: false }, '2026-08-04')
    ).toBe('ended');
  });

  it('claims nothing when the dates are not ISO days', () => {
    // Rather than guessing. A malformed date must not be silently treated as
    // "in force".
    expect(
      intervalState({ validFrom: 'yesterday', validTo: null, active: true }, '2026-08-04')
    ).toBe('unknown');
    expect(
      intervalState({ validFrom: '2026-01-01', validTo: 'soon', active: false }, '2026-08-04')
    ).toBe('unknown');
  });
});

describe('an odometer value stays a string', () => {
  const base: OdometerReadingEntry = {
    id: 'o1',
    value: '123456.789',
    unit: 'km',
    valueKm: '123456.789',
    observedAt: '2026-08-04T10:00:00.000Z',
    captureMethod: 'manual',
    anomalyFlag: false,
    correctionOf: null,
    correctionReason: null,
  };

  it('renders the value with its own unit, unconverted', () => {
    expect(
      odometerDisplay({ ...base, value: '76543.21', unit: 'mi', valueKm: '123184.6' })
    ).toEqual({ primary: '76543.21 mi', canonical: '123184.6 km' });
  });

  it('preserves a precision no float could hold', () => {
    const exotic = '123456789012345678901234567890.123456789';
    const display = odometerDisplay({ ...base, value: exotic, valueKm: exotic });
    // Character-for-character. A `parseFloat` round-trip would silently change
    // these digits, and `numeric` is cast `::text` precisely to avoid that.
    expect(display.primary).toBe(`${exotic} km`);
    expect(display.canonical).toBe(`${exotic} km`);
  });

  it('reports a NULL canonical value rather than computing one', () => {
    // `value_km` is the comparable column and it is the NULLABLE one. Deriving
    // it here would be a second authority that disagrees with the database's
    // generated column at the rounding.
    expect(odometerDisplay({ ...base, unit: 'mi', valueKm: null }).canonical).toBeNull();
  });

  it('never yields a number', () => {
    const display = odometerDisplay(base);
    expect(typeof display.primary).toBe('string');
    expect(display.canonical === null || typeof display.canonical === 'string').toBe(true);
  });

  it('recognises a correction by either signal', () => {
    // A correction is a reading ABOUT another reading, and belongs in the
    // history differently from an ordinary observation.
    expect(isCorrection(base)).toBe(false);
    expect(isCorrection({ ...base, correctionOf: 'o0' })).toBe(true);
    expect(isCorrection({ ...base, captureMethod: 'correction' })).toBe(true);
  });
});

/**
 * The readings a correction may point at (`P1-27-FE-023`).
 *
 * `correctionOf` is a uuid, and a text box for one would be a control no
 * workshop employee could use — the conclusion `TransferOwnershipForm` reached
 * about `partnerId`, and the reason ownership transfer was reachable from no
 * screen for the whole of P1-27. So the id is carried and the LABEL is what is
 * shown.
 */
describe('a prior reading is offered by its words, not by its id', () => {
  const first: OdometerReadingEntry = {
    id: 'f1a2b3c4-0000-4000-8000-000000000001',
    value: '120000',
    unit: 'km',
    valueKm: '120000',
    observedAt: '2026-01-10T08:00:00.000Z',
    captureMethod: 'manual',
    anomalyFlag: false,
    correctionOf: null,
    correctionReason: null,
  };
  const second: OdometerReadingEntry = {
    ...first,
    id: 'f1a2b3c4-0000-4000-8000-000000000002',
    value: '76543.21',
    unit: 'mi',
    valueKm: '123184.6',
    observedAt: '2026-03-04T09:30:00.000Z',
    captureMethod: 'reception',
  };
  /** A fixed formatter, so this stays a test of the derivation and not of Intl. */
  const at = (observedAt: string) => `AT:${observedAt}`;

  it('carries the id as the value and the reading as the label', () => {
    const choices = correctionChoices([first, second], at);
    // Anti-vacuity: two readings in, two choices out.
    expect(choices).toHaveLength(2);
    expect(choices[0]).toEqual({
      value: first.id,
      label: `120000 km — AT:${first.observedAt}`,
    });
  });

  it('keeps the unit the reading was taken in, unconverted', () => {
    // The same rule the table one component away follows: `value_km` is the
    // database's generated column, and a second conversion here would be a
    // second authority that disagrees at the rounding.
    const [, miles] = correctionChoices([first, second], at);
    expect(miles?.label.startsWith('76543.21 mi')).toBe(true);
    expect(miles?.label).not.toContain('123184.6');
  });

  it('offers exactly the readings it was given, in the order it was given them', () => {
    /*
     * The property that makes a reading from ANOTHER vehicle unofferable. The
     * rows come from `veh.vehicle-odometer-history` for one vehicle id, so
     * "derived from this list" and "belongs to this vehicle" are the same fact —
     * as long as nothing here invents, reorders or drops an entry.
     */
    const choices = correctionChoices([second, first], at);
    expect(choices.map((choice) => choice.value)).toEqual([second.id, first.id]);
  });

  it('filters nothing — not by time, and not by whether the row is itself a correction', () => {
    /*
     * A client bound that disagrees with the server refuses a value the server
     * would have stored, which is what `FieldSpec`'s docblock forbids. "Earlier
     * or equal" is decided in the database against the value being written, and
     * that value does not exist until the form is submitted, so filtering here
     * could only ever be a guess. `form.violation.not_earlier` states the
     * refusal instead.
     */
    const correction: OdometerReadingEntry = {
      ...first,
      id: 'f1a2b3c4-0000-4000-8000-000000000003',
      captureMethod: 'correction',
      anomalyFlag: true,
      correctionOf: first.id,
      correctionReason: 'data_entry_correction',
    };
    expect(isCorrection(correction)).toBe(true);
    expect(correctionChoices([first, correction], at).map((c) => c.value)).toEqual([
      first.id,
      correction.id,
    ]);
  });

  it('offers nothing when there is nothing to correct', () => {
    // The empty-history case, stated rather than left to the caller: a section
    // that has loaded no readings must not render a selector it cannot populate.
    expect(correctionChoices([], at)).toEqual([]);
  });
});

describe('the history adapters send only what the contract accepts', () => {
  it('builds each path from a fixed segment with the id encoded', async () => {
    client.get.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });

    await listOwnerships('../../admin', REQUEST, null);
    const [path] = client.get.mock.calls[0] as [string];
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
    expect(path).toContain('/ownerships');
  });

  it('publishes no total on any of the three', async () => {
    client.get.mockResolvedValue({
      ok: true,
      data: { items: [{ id: 'x' }], nextCursor: 'cur', hasMore: true },
      correlationId: 'c',
    });
    for (const call of [listOwnerships, listPlates, listOdometerReadings]) {
      const result = await call('v1', REQUEST, null);
      expect(result).not.toHaveProperty('total');
      expect(result.hasMore).toBe(true);
    }
  });

  it('never retries', async () => {
    client.get.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    await listPlates('v1', REQUEST, null);
    const [, options] = client.get.mock.calls[0] as [string, { retries: number }];
    expect(options.retries).toBe(0);
  });

  it('maps every failure kind to a status', async () => {
    for (const kind of ['forbidden', 'not-found', 'server', 'timeout', 'rate-limited']) {
      client.get.mockResolvedValue({ ok: false, kind, correlationId: 'c' });
      const result = await listOdometerReadings('v1', REQUEST, null);
      expect(result.status, kind).toBeTypeOf('string');
      expect(result.rows, kind).toEqual([]);
    }
  });
});

describe('every vocabulary is complete and translated', () => {
  it('matches the CHECK constraints', () => {
    expect([...OWNERSHIP_KINDS]).toEqual(['registered_owner', 'beneficial', 'fleet']);
    expect([...ODOMETER_UNITS]).toEqual(['km', 'mi']);
    expect([...ODOMETER_CAPTURE_METHODS]).toEqual(['reception', 'delivery', 'manual']);
    expect([...ODOMETER_ANOMALY_REASONS]).toEqual([
      'lower_than_prior',
      'possible_rollover',
      'meter_replacement',
      'data_entry_correction',
    ]);
  });

  it('has an English and an Arabic label for every value, plus correction', () => {
    const required = [
      ...OWNERSHIP_KINDS.map((v) => `vehicles.ownershipKind.${v}`),
      // `correction` is not in ODOMETER_CAPTURE_METHODS — the read can return it
      // while the write cannot send it, and a missing key would render raw.
      ...[...ODOMETER_CAPTURE_METHODS, 'correction'].map((v) => `vehicles.captureMethod.${v}`),
      // `unknown` is the same shape as `correction` above, one column over: the
      // platform's `ODOMETER_ANOMALY_REASONS` carries five members and the route
      // accepts all five, while the form deliberately offers four — "unknown" is
      // what a reason is when nobody recorded one, not something to invite an
      // operator to choose. A reading that arrives carrying it must still read
      // as words rather than as the raw token.
      ...[...ODOMETER_ANOMALY_REASONS, 'unknown'].map((v) => `vehicles.anomalyReason.${v}`),
      ...['in-force', 'scheduled', 'ended', 'unknown'].map((v) => `vehicles.interval.${v}`),
    ];
    const missing = required.filter((k) => !(k in en) || !(k in ar));
    expect(missing).toEqual([]);
  });
});
