import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { OdometerReadingEntry, PlateHistoryEntry } from '@/features/vehicles/history-contract';

/**
 * `PlateSection` and `OdometerSection` with real rows and real writes
 * (`P1-27-FE-022`, `P1-27-FE-023`).
 *
 * The file is named for the plate section it began as. The odometer correction
 * cases live here rather than in a file of their own because three gates assert
 * the web tier's test-FILE count, and because this is the only suite in the tree
 * that drives a history section through its REAL adapter — which is precisely
 * what those cases need.
 *
 * ## What was untested
 *
 * The only file that touched this section was
 * `write-permission-gating.dom.test.tsx`, and its list mock always resolved
 * `{ rows: [] }`. So no test in the suite had ever rendered a plate row, a plate
 * column, or the four-state interval badge — the whole visible output of the
 * section was uncovered, and the gating file could not have noticed because an
 * empty table renders identically whether the columns are right or absent.
 *
 * The WRITE was driven exactly once, by the scope-smuggle sweep in
 * `p1-27-qa.test.ts`, which asserts only that the body carries no tenant,
 * company or branch. That case passes whether or not the schema at
 * `history-api.ts:118-133` works at all.
 *
 * ## How this file differs from every other DOM suite here
 *
 * It mocks **only** `@/lib/api/server-client`. `listPlates` and
 * `assignPlateAction` are the real adapters, so the rows on screen came through
 * the real read mapping and the submitted form ran the real Zod schema. A suite
 * that mocked the adapter module could not tell a working column from a missing
 * one, which is exactly how this section shipped.
 *
 * The unit-level bounds live in `write-adapters-driven.test.ts`; what this file
 * adds is that the operator can reach them — that the control exists, carries
 * the value typed into it, and shows the refusal against the right field.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { PlateSection, OdometerSection } =
  await import('@/features/vehicles/components/VehicleHistorySections');

const VEHICLE = 'a1b2c3d4-0000-4000-8000-000000000001';
/** Fixed, so "in force" is a property of the data rather than of the clock. */
const TODAY = '2026-08-08';

/*
 * Three rows, one per state the badge can reach that is not `unknown`.
 *
 * `active` is `valid_to IS NULL` and is deliberately TRUE on the scheduled row:
 * that is the distinction the badge exists for, and a column that printed
 * `active` would call a plate that starts next year "in force" today.
 */
const IN_FORCE: PlateHistoryEntry = {
  id: 'plate-1',
  countryCode: 'JO',
  plate: '12-3456',
  validFrom: '2024-01-01',
  validTo: null,
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
};
const SCHEDULED: PlateHistoryEntry = {
  id: 'plate-2',
  countryCode: 'JO',
  plate: '77-8899',
  validFrom: '2027-01-01',
  validTo: null,
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
};
const ENDED: PlateHistoryEntry = {
  id: 'plate-3',
  countryCode: 'UAE',
  plate: 'A-11111',
  validFrom: '2020-01-01',
  validTo: '2023-12-31',
  active: false,
  createdAt: '2020-01-01T00:00:00.000Z',
};

function page<Row>(rows: readonly Row[]) {
  return {
    ok: true as const,
    data: { items: rows, nextCursor: null, hasMore: false },
    correlationId: 'fixed-correlation-id',
  };
}

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  get.mockResolvedValue(page([IN_FORCE, SCHEDULED, ENDED]));
  send.mockResolvedValue({ ok: true, data: {}, correlationId: 'fixed-correlation-id' });
});

/** The `<tr>` a given normalised plate is printed in. */
async function rowFor(plate: string): Promise<HTMLElement> {
  const cell = await screen.findByText(plate);
  const row = cell.closest('tr');
  expect(row, `no row rendered for ${plate}`).not.toBeNull();
  return row as HTMLElement;
}

describe('the plate table renders the rows the read returns', () => {
  it('asks the plate operation for this vehicle and prints every row it answers', async () => {
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const path = String(get.mock.calls[0]?.[0] ?? '');
    expect(path.startsWith(`/api/v1/vehicles/${VEHICLE}/plates`)).toBe(true);

    // Three rows, not "a table exists". The suite had never rendered one.
    for (const row of [IN_FORCE, SCHEDULED, ENDED]) {
      expect(await screen.findByText(row.plate)).toBeTruthy();
    }
  });

  it('prints the NORMALISED plate and the country code, each in its own column', async () => {
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);

    const row = await rowFor(ENDED.plate);
    expect(within(row).getByText(ENDED.countryCode)).toBeTruthy();
    // The dates are printed exactly as stored: these columns are PostgreSQL
    // `date`, read `::text`, and a single `new Date()` would render the previous
    // day for every operator west of Greenwich.
    expect(within(row).getByText(ENDED.validFrom)).toBeTruthy();
    expect(within(row).getByText(ENDED.validTo as string)).toBeTruthy();
  });

  it('renders every column the section declares, and no header without cells', async () => {
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);
    await screen.findByText(IN_FORCE.plate);

    for (const header of [
      en['vehicles.search.plate'],
      en['vehicles.plate.country'],
      en['vehicles.interval.from'],
      en['vehicles.interval.to'],
      en['crm.customers.column.status'],
    ]) {
      expect(screen.getAllByText(header).length, header).toBeGreaterThan(0);
    }
  });

  it('shows an open interval as having no end date rather than inventing one', async () => {
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);
    const row = await rowFor(IN_FORCE.plate);
    // The em dash `Day` renders for a null `valid_to`. Printing today's date, or
    // nothing at all, would both say something the data does not.
    expect(within(row).getByText('—')).toBeTruthy();
  });
});

describe('the interval badge says what active cannot', () => {
  it('distinguishes in force, scheduled and ended on the same table', async () => {
    /*
     * The one assertion that makes the badge worth having. `active` is
     * `valid_to IS NULL`, so `SCHEDULED` is active AND not in force — a column
     * driven by `active` would label a plate that starts in 2027 as current
     * today, which is a registration claim about a vehicle on the road.
     */
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);

    expect(
      within(await rowFor(IN_FORCE.plate)).getByText(en['vehicles.interval.in-force'])
    ).toBeTruthy();
    expect(
      within(await rowFor(SCHEDULED.plate)).getByText(en['vehicles.interval.scheduled'])
    ).toBeTruthy();
    expect(within(await rowFor(ENDED.plate)).getByText(en['vehicles.interval.ended'])).toBeTruthy();

    // And the scheduled row really is the `active: true` one, so the case above
    // is about the badge rather than about a coincidence in the fixture.
    expect(SCHEDULED.active).toBe(true);
  });

  it('claims nothing when the dates are not ISO days', async () => {
    get.mockResolvedValue(page([{ ...IN_FORCE, validFrom: 'not-a-date' }]));
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} />);
    const row = await rowFor(IN_FORCE.plate);
    expect(within(row).getByText(en['vehicles.interval.unknown'])).toBeTruthy();
  });

  it('renders the badge in Arabic too, and not as the English string', async () => {
    expect(ar['vehicles.interval.in-force']).not.toBe(en['vehicles.interval.in-force']);
    renderRtl(<PlateSection locale="ar" messages={ar} vehicleId={VEHICLE} today={TODAY} />);
    const row = await rowFor(IN_FORCE.plate);
    expect(within(row).getByText(ar['vehicles.interval.in-force'])).toBeTruthy();
  });
});

describe('the assignment form runs the real validation', () => {
  /** Renders with the write offered and waits for the table to settle. */
  async function open() {
    const user = userEvent.setup();
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} canEdit />);
    await screen.findByText(IN_FORCE.plate);
    await screen.findByRole('button', { name: en['vehicles.plate.assign'] });
    return user;
  }

  it('sends the country code uppercased and the plate exactly as typed', async () => {
    const user = await open();
    await user.type(screen.getByLabelText(/^Country/), 'jo');
    await user.type(screen.getByLabelText(/^Plate number/), '12-3456');
    await user.click(screen.getByRole('button', { name: en['vehicles.plate.assign'] }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [method, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/plates`);
    expect(body).toEqual({ countryCode: 'JO', plateRaw: '12-3456' });
  });

  it('refuses a one-letter country against that field, without spending a request', async () => {
    /*
     * The schema's own bound, reached the way an operator reaches it. The field
     * carries `maxLength={3}` so the ceiling is unreachable from the control;
     * the FLOOR is not, and a two-character minimum is not something anyone can
     * see. Before this, the only driver of this action asserted nothing about
     * the schema at all.
     */
    const user = await open();
    await user.type(screen.getByLabelText(/^Country/), 'J');
    await user.type(screen.getByLabelText(/^Plate number/), '12-3456');
    await user.click(screen.getByRole('button', { name: en['vehicles.plate.assign'] }));

    const alert = await screen.findByText(en['vehicles.plate.error.country']);
    expect(alert).toBeTruthy();
    // The load-bearing half: a version that refused the value AFTER issuing the
    // request would satisfy the message assertion and still burn a rate-limit
    // slot, on an operation the platform limits to thirty a minute.
    expect(send, 'the edge sent a request it could have refused itself').toHaveBeenCalledTimes(0);
  });

  it('keeps what the operator typed when the write is refused', async () => {
    // The behaviour `RecordForm` exists for. React resets an uncontrolled form
    // once a Server Action completes, so a refusal would silently empty both
    // fields and ask them to retype a plate for a mistake in one letter.
    const user = await open();
    await user.type(screen.getByLabelText(/^Country/), 'J');
    await user.type(screen.getByLabelText(/^Plate number/), '12-3456');
    await user.click(screen.getByRole('button', { name: en['vehicles.plate.assign'] }));

    await screen.findByText(en['vehicles.plate.error.country']);
    expect((screen.getByLabelText(/^Plate number/) as HTMLInputElement).value).toBe('12-3456');
    expect((screen.getByLabelText(/^Country/) as HTMLInputElement).value).toBe('J');
  });

  it('re-reads the list after a successful assignment', async () => {
    // The new plate is now the one in force, and the row above the form is the
    // only place that says so. Without the re-read the operator is told the
    // plate was added by a table that does not contain it.
    const user = await open();
    expect(get).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText(/^Country/), 'JO');
    await user.type(screen.getByLabelText(/^Plate number/), '99-0000');
    await user.click(screen.getByRole('button', { name: en['vehicles.plate.assign'] }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
    // And the form is cleared, because the record is stored and the next entry
    // is a different plate.
    await waitFor(() =>
      expect((screen.getByLabelText(/^Plate number/) as HTMLInputElement).value).toBe('')
    );
  });

  it('offers a date control, so the day the operator picks cannot shift', async () => {
    await open();
    const date = screen.getByLabelText(en['vehicles.plate.effectiveFrom']) as HTMLInputElement;
    // A `date` input yields `YYYY-MM-DD` with no time and no zone. A text box
    // here would let a locale-shaped date through the ten-character check.
    expect(date.type).toBe('date');
  });
});

/**
 * Recording a correction to an odometer reading (`P1-27-FE-023`).
 *
 * ## The capability that was missing
 *
 * A reading entered too high could never be brought back down from the product.
 * `guard_odometer_reading` refuses a NORMAL reading below the current effective
 * value — correctly, because that refusal IS the anomaly detection, and the
 * original is preserved — and the platform's remedy is a CORRECTION: the same
 * operation, `veh.vehicle-odometer-record`, with `correctionOf` and
 * `correctionReason` added. The form offered neither control, so the refusal was
 * the end of the road for the operator.
 *
 * `FE-022` beside it is the sibling that shows this was an omission rather than
 * a decision: its form sends the route's optional `effectiveDate`, and its
 * matrix cell records the reason as "fields match the route". `FE-023` was the
 * only write in the phase that did not.
 *
 * ## What these cases can see that the adapter tests cannot
 *
 * The adapter suite proves the body. It cannot prove that an operator can reach
 * it: that the options carry readings rather than uuids, that the set comes from
 * THIS vehicle, that a refusal lands under the control that caused it, or that a
 * failed attempt does not silently discard the three things they chose.
 */
describe('an odometer reading can be corrected', () => {
  /** The reading a correction will point at — the one entered too high. */
  const TOO_HIGH: OdometerReadingEntry = {
    id: 'f1a2b3c4-0000-4000-8000-000000000001',
    value: '180000',
    unit: 'km',
    valueKm: '180000',
    observedAt: '2026-03-04T09:30:00.000Z',
    captureMethod: 'reception',
    anomalyFlag: false,
    correctionOf: null,
    correctionReason: null,
  };
  const EARLIER: OdometerReadingEntry = {
    ...TOO_HIGH,
    id: 'f1a2b3c4-0000-4000-8000-000000000002',
    value: '120000',
    valueKm: '120000',
    observedAt: '2026-01-10T08:00:00.000Z',
    captureMethod: 'manual',
  };
  /** The correction as the history reads it back. */
  const CORRECTION: OdometerReadingEntry = {
    ...TOO_HIGH,
    id: 'f1a2b3c4-0000-4000-8000-000000000003',
    value: '118000',
    valueKm: '118000',
    captureMethod: 'correction',
    anomalyFlag: true,
    correctionOf: TOO_HIGH.id,
    correctionReason: 'data_entry_correction',
  };
  /** A reading of a DIFFERENT vehicle. It is never in any page this section reads. */
  const FOREIGN_ID = 'f1a2b3c4-0000-4000-8000-0000000000ff';

  const ODOMETER = { locale: 'en' as const, messages: en, vehicleId: VEHICLE };

  beforeEach(() => {
    get.mockResolvedValue(page([TOO_HIGH, EARLIER]));
  });

  /** Renders with the write offered and waits for the form to mount. */
  async function open() {
    const user = userEvent.setup();
    renderLtr(<OdometerSection {...ODOMETER} canRecord />);
    await screen.findByRole('combobox', { name: en['vehicles.odometer.correctionOf'] });
    return user;
  }

  const priorSelect = () =>
    screen.getByRole('combobox', { name: en['vehicles.odometer.correctionOf'] });
  const reasonSelect = () =>
    screen.getByRole('combobox', { name: en['vehicles.odometer.correctionReason'] });
  const readingBox = () =>
    screen.getByRole('spinbutton', { name: en['vehicles.odometer.reading'] });
  const observedBox = () =>
    screen.getByRole('textbox', { name: en['vehicles.odometer.observedAt'] });
  const submit = () => screen.getByRole('button', { name: en['vehicles.odometer.record'] });

  /** Fills the three fields every reading needs, correction or not. */
  async function enterReading(user: ReturnType<typeof userEvent.setup>, value: string) {
    await user.type(readingBox(), value);
    await user.selectOptions(
      screen.getByRole('combobox', { name: en['vehicles.odometer.unit'] }),
      'km'
    );
    await user.type(observedBox(), '2026-03-05T09:30:00Z');
  }

  it('offers the prior readings by value and time, and never by id', async () => {
    await open();

    const options = [...priorSelect().querySelectorAll('option')];
    // Anti-vacuity: the placeholder plus the two rows the read returned.
    expect(options).toHaveLength(3);

    const labels = options.map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.startsWith('180000 km'))).toBe(true);
    expect(labels.some((label) => label.startsWith('120000 km'))).toBe(true);
    // The observed time is in the label, in the operator's own format — the
    // second half of "human information", and what tells two readings of the
    // same value apart.
    expect(labels.filter((label) => label.includes('2026'))).toHaveLength(2);
    // And the id is carried, not shown.
    expect(labels.join('|'), 'a uuid reached the screen').not.toContain(TOO_HIGH.id);
    expect(options.map((option) => option.value)).toContain(TOO_HIGH.id);
  });

  it('offers only readings of THIS vehicle, because the set is the list it just read', async () => {
    /*
     * The guarantee that a reading belonging to another vehicle cannot be
     * submitted from the interface. The rows come from
     * `veh.vehicle-odometer-history` for this vehicle id — asserted, not assumed
     * — and the options are exactly those rows. The server refuses a foreign id
     * anyway with a foreign-key violation mapped to `unknown_reference`; this is
     * the reason an operator never has to meet it.
     */
    await open();

    const requested = String(get.mock.calls[0]?.[0] ?? '');
    expect(requested.startsWith(`/api/v1/vehicles/${VEHICLE}/odometer-readings`)).toBe(true);

    const offered = [...priorSelect().querySelectorAll('option')]
      .map((option) => option.value)
      .filter((value) => value.length > 0);
    expect(offered).toEqual([TOO_HIGH.id, EARLIER.id]);
    expect(offered, 'a reading from another vehicle was offered').not.toContain(FOREIGN_ID);
  });

  it('offers no correction control when the vehicle has no readings yet', async () => {
    /*
     * A correction points AT a reading. With none on the page there is nothing
     * to point at, and an empty selector is a control that can only fail — the
     * same failure as offering a form to an operator who cannot use it. The
     * reading form itself stays: a first reading is a normal one by definition.
     */
    get.mockResolvedValue(page<OdometerReadingEntry>([]));
    renderLtr(<OdometerSection {...ODOMETER} canRecord />);

    await screen.findByRole('button', { name: en['vehicles.odometer.record'] });
    expect(
      screen.queryByRole('combobox', { name: en['vehicles.odometer.correctionOf'] })
    ).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: en['vehicles.odometer.correctionReason'] })
    ).toBeNull();
  });

  it('sends neither correction field for an ordinary increasing reading', async () => {
    // The control for every case below. A form that always sent the pair would
    // turn every routine reading into a check-constraint violation.
    const user = await open();
    await enterReading(user, '190000');
    await user.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [, , body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(body).toEqual({ value: 190000, unit: 'km', observedAt: '2026-03-05T09:30:00Z' });
  });

  it('sends both values when a prior reading and a reason are chosen', async () => {
    const user = await open();
    await enterReading(user, '118000');
    await user.selectOptions(priorSelect(), TOO_HIGH.id);
    await user.selectOptions(reasonSelect(), 'data_entry_correction');
    await user.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [method, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/odometer-readings`);
    expect(body.correctionOf).toBe(TOO_HIGH.id);
    expect(body.correctionReason).toBe('data_entry_correction');
    // The value went DOWN, which is the whole point: a normal reading here would
    // be refused by the database and a correction is how it is recorded.
    expect(body.value).toBe(118000);
  });

  it('refuses a chosen reading with no reason, against that control, without sending', async () => {
    const user = await open();
    await enterReading(user, '118000');
    await user.selectOptions(priorSelect(), TOO_HIGH.id);
    await user.click(submit());

    expect(await screen.findByText(en['vehicles.odometer.error.reasonRequired'])).toBeTruthy();
    // The load-bearing half: refusing after the request would satisfy the
    // message assertion and still spend one of thirty calls a minute.
    expect(send, 'the edge sent a request it could have refused itself').toHaveBeenCalledTimes(0);
  });

  it('tells a downward reading what to do about it, and the control it names exists', async () => {
    /*
     * The refusal an operator actually meets. The server answers
     * `422 ERR-VAL-001` with `body.value` / `below_current_odometer`, which
     * `violationKeysOf` maps onto the reading box.
     *
     * Until this wave the copy stopped at "a lower reading is not stored",
     * because naming the remedy would have described a control that did not
     * exist. It now names it — so the case asserts BOTH halves at once: the
     * sentence, and the control the sentence sends them to.
     */
    send.mockResolvedValue({
      ok: false,
      kind: 'validation',
      status: 422,
      problem: {
        code: 'ERR-VAL-001',
        violations: [{ path: 'body.value', rule: 'below_current_odometer' }],
      },
      correlationId: 'fixed-correlation-id',
    });

    const user = await open();
    await enterReading(user, '118000');
    await user.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const refusal = await screen.findByText(en['form.violation.below_current_odometer']);
    expect(refusal).toBeTruthy();
    // Truthful guidance: the message says to choose the earlier reading it
    // corrects, and that selector is on the same screen.
    expect(en['form.violation.below_current_odometer']).toMatch(/correct/i);
    expect(priorSelect()).toBeTruthy();
    expect(reasonSelect()).toBeTruthy();
  });

  it('keeps the reading, the prior choice and the reason when the write fails', async () => {
    /*
     * `NEW-FE-01`, on the two controls this wave added. A reverted select leaves
     * no visual trace, so an operator who hit a 503 would press Save again on a
     * form that had silently become an ordinary reading — and a downward
     * ordinary reading is refused, which reads as the product losing the
     * correction twice.
     */
    send.mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      status: 503,
      problem: null,
      correlationId: 'fixed-correlation-id',
    });

    const user = await open();
    await enterReading(user, '118000');
    await user.selectOptions(priorSelect(), TOO_HIGH.id);
    await user.selectOptions(reasonSelect(), 'possible_rollover');
    await user.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(priorSelect()).toHaveValue(TOO_HIGH.id));
    expect(reasonSelect()).toHaveValue('possible_rollover');
    expect(readingBox()).toHaveValue(118000);
    expect(observedBox()).toHaveValue('2026-03-05T09:30:00Z');
  });

  it('shows the correction in the history in words, with the original still listed', async () => {
    /*
     * The read side, which is what the operator checks afterwards. A correction
     * never edits or deletes the reading it corrects: the history keeps both and
     * the effective odometer simply ignores the superseded one.
     */
    get.mockResolvedValue(page([CORRECTION, TOO_HIGH, EARLIER]));
    renderLtr(<OdometerSection {...ODOMETER} />);

    const correctionRow = (await screen.findByText('118000 km')).closest('tr') as HTMLElement;
    expect(correctionRow).not.toBeNull();
    // Plain business language, and the same vocabulary the form offers.
    expect(within(correctionRow).getByText(en['vehicles.odometer.correction'])).toBeTruthy();
    expect(
      within(correctionRow).getByText(en['vehicles.anomalyReason.data_entry_correction'])
    ).toBeTruthy();
    expect(within(correctionRow).getByText(en['vehicles.odometer.anomaly'])).toBeTruthy();

    // The original is still there, still reading as an ordinary observation.
    const originalRow = screen.getByText('180000 km').closest('tr') as HTMLElement;
    expect(originalRow).not.toBeNull();
    expect(within(originalRow).queryByText(en['vehicles.odometer.correction'])).toBeNull();
    expect(within(originalRow).getByText(en['vehicles.captureMethod.reception'])).toBeTruthy();
  });

  it('re-reads the history after a correction is recorded', async () => {
    // The corrected value is now the effective one and the table above the form
    // is the only place that says so.
    const user = await open();
    expect(get).toHaveBeenCalledTimes(1);

    await enterReading(user, '118000');
    await user.selectOptions(priorSelect(), TOO_HIGH.id);
    await user.selectOptions(reasonSelect(), 'meter_replacement');
    await user.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers nothing at all when the history read failed', async () => {
    // The control for this whole block: every case above would pass against a
    // section that rendered an empty table, so the failure path must look
    // different — no table, and no write form of any kind.
    get.mockResolvedValue({ ok: false, kind: 'forbidden', correlationId: 'fixed-correlation-id' });
    renderLtr(<OdometerSection {...ODOMETER} canRecord />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('180000 km')).toBeNull());
    expect(screen.queryByRole('button', { name: en['vehicles.odometer.record'] })).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: en['vehicles.odometer.correctionOf'] })
    ).toBeNull();
  });
});

describe('this file is not vacuous', () => {
  it('renders nothing at all when the read failed', async () => {
    // The control for every case above: they would each pass against a section
    // that rendered an empty table, so the failure path must look different.
    get.mockResolvedValue({ ok: false, kind: 'forbidden', correlationId: 'fixed-correlation-id' });
    renderLtr(<PlateSection locale="en" messages={en} vehicleId={VEHICLE} today={TODAY} canEdit />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(IN_FORCE.plate)).toBeNull());
    // And no write form, because `HistorySection` gates it on a successful read.
    expect(screen.queryByRole('button', { name: en['vehicles.plate.assign'] })).toBeNull();
  });

  it('resolves every label it asserts on', () => {
    for (const label of [
      en['vehicles.plate.assign'],
      en['vehicles.plate.error.country'],
      en['vehicles.plate.effectiveFrom'],
      en['vehicles.interval.in-force'],
      en['vehicles.interval.scheduled'],
      en['vehicles.interval.ended'],
      en['vehicles.interval.unknown'],
    ]) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
