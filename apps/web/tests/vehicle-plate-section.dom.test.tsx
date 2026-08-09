import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { PlateHistoryEntry } from '@/features/vehicles/history-contract';

/**
 * `PlateSection` with real rows and a real write (`P1-27-FE-022`).
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

const { PlateSection } = await import('@/features/vehicles/components/VehicleHistorySections');

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

function page(rows: readonly PlateHistoryEntry[]) {
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
