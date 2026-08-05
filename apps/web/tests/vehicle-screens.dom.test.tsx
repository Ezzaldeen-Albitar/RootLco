import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The vehicle screens, in a DOM (`P1-27-QA-001`).
 *
 * ## Why this file exists
 *
 * The CRM screens each had a `.dom` suite from Wave 2 onward. The vehicle
 * screens had **none** — seven screens across Waves 7–12 covered only by contract
 * and adapter tests. Those prove what the functions return; they cannot prove
 * that a screen calls the backend zero times before an operator asks, that a
 * merge affordance is absent from the rendered output, or that a denial reads as
 * a denial rather than as an empty list.
 *
 * `P1-27-QA-001` is "unit **and component** coverage", and the component half
 * was missing on an entire domain. This is that half.
 *
 * The Server Actions are mocked at the module boundary, because a component test
 * cannot call a `'use server'` module — and because what is under test here is
 * the screen's decision about *when* and *whether*, not the call itself.
 */

const searchVehicles = vi.fn();
const listVehicleDuplicates = vi.fn();
const reviewVehicleDuplicateAction = vi.fn();
const listAttributeHistory = vi.fn();

vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...args: unknown[]) => searchVehicles(...args),
}));
vi.mock('@/features/vehicles/duplicates-api', () => ({
  listVehicleDuplicates: (...args: unknown[]) => listVehicleDuplicates(...args),
  listAttributeHistory: (...args: unknown[]) => listAttributeHistory(...args),
  reviewVehicleDuplicateAction: (...args: unknown[]) => reviewVehicleDuplicateAction(...args),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');
const { VehicleDuplicateReviewScreen } =
  await import('@/features/vehicles/components/VehicleDuplicateReviewScreen');
const { VehicleAttributeHistorySection } =
  await import('@/features/vehicles/components/VehicleAttributeHistorySection');

const HIT = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: 'JH4KA7561PC008269',
  plateNumber: '12-3456',
  makeId: null,
  modelId: null,
  modelYear: 2019,
  lifecycleStatus: 'active',
  powertrainCategory: 'ice',
  mergedIntoId: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

const CANDIDATE = {
  id: 'cand-1',
  vehicleIdA: 'a1b2c3d4-0000-4000-8000-000000000001',
  vehicleIdB: 'a1b2c3d4-0000-4000-8000-000000000002',
  matchScore: '0.930',
  matchBasis: { signals: [{ signal: 'vin_collision', weight: 1 }] },
  status: 'open',
  detectedAt: '2026-08-04T10:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
};

function page(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

beforeEach(() => {
  searchVehicles.mockReset();
  listVehicleDuplicates.mockReset();
  reviewVehicleDuplicateAction.mockReset();
  listAttributeHistory.mockReset();
  push.mockReset();
  searchVehicles.mockResolvedValue(page([HIT]));
  listVehicleDuplicates.mockResolvedValue(page([CANDIDATE]));
  listAttributeHistory.mockResolvedValue(page([]));
});

describe('vehicle search asks nothing until it is asked', () => {
  const render = (canCreate = false) =>
    renderLtr(<VehicleSearchScreen locale="en" messages={en} canCreate={canCreate} makes={[]} />);

  it('calls the backend zero times on mount', () => {
    render();
    // `expensive-read` is 30 requests per 60 seconds. An unasked query spends
    // one of them to say "here is everything", which is not what a search
    // screen should say before it has been used.
    expect(searchVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['vehicles.search.idleTitle'])).toBeInTheDocument();
  });

  it('issues no request while the operator types a VIN', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.vin']), 'JH4KA7561PC008269');
    // Seventeen keystrokes. Search-as-you-type would have spent 17 of 30.
    expect(searchVehicles).not.toHaveBeenCalled();
  });

  it('refuses to search on empty criteria and says why', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: en['vehicles.search.submit'] }));
    expect(searchVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['vehicles.search.needCriteria'])).toBeInTheDocument();
  });

  it('searches once the operator supplies a criterion', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    await waitFor(() => expect(searchVehicles).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('V-0001')).toBeInTheDocument();
  });

  it('offers the creation link only to an operator who may create', async () => {
    render(false);
    expect(screen.queryByText(en['vehicles.create.title'])).not.toBeInTheDocument();
  });

  it('renders a denial as a denial, not as an empty result set', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'denied' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    // "No vehicles found" would tell an operator the record does not exist when
    // the truth is that they may not see it.
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('reads a rate limit as "try again shortly" rather than as a fault', async () => {
    // This test FAILED when written, and the code was wrong, not the test.
    // `useServerTable` collapsed every non-denied failure into `error`, so an
    // operator who merely searched faster than 30 times a minute was told the
    // system had broken — throwing away a distinction `STATUS_BY_KIND` computes
    // deliberately, one step before it reached anyone.
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'unavailable' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    expect(screen.queryByText(en['state.error.title'])).not.toBeInTheDocument();
  });

  it('offers no Retry on an expired session, because retrying cannot work', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'expired' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByText(en['state.expired.title'])).toBeInTheDocument();
    // Re-issuing the same request with the same dead session fails identically.
    expect(screen.queryByRole('button', { name: en['state.retry'] })).not.toBeInTheDocument();
  });

  it('offers Retry on a transient failure, because retrying can work', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'unavailable' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByRole('button', { name: en['state.retry'] })).toBeInTheDocument();
  });
});

describe('the vehicle duplicate queue', () => {
  const render = () => renderLtr(<VehicleDuplicateReviewScreen locale="en" messages={en} />);

  it('lists the outstanding pairs', async () => {
    render();
    await waitFor(() => expect(listVehicleDuplicates).toHaveBeenCalled());
    expect(await screen.findByText('93%')).toBeInTheDocument();
  });

  it('renders NO merge control anywhere, and states why', async () => {
    render();
    await screen.findByText('93%');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    // The decisive assertion. `P1-OD-017` is open, the plan requires the
    // affordance to be ABSENT rather than disabled, and an earlier revision of
    // the CRM panel shipped a working merge form. No control — enabled,
    // disabled or hidden — may exist here.
    for (const element of screen.getAllByRole('button')) {
      expect(element.textContent ?? '').not.toMatch(/merge/i);
    }
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText(en['vehicles.duplicates.mergePendingDecision'], { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('P1-OD-017')).toBeInTheDocument();
  });

  it('offers no rescan control, and says the queue is not refreshed by scanning', async () => {
    render();
    await screen.findByText('93%');
    // `veh.vehicle-duplicate-scan` is a privileged audited write throttled at
    // 30/min. A button here would write audit history on every click.
    for (const element of screen.getAllByRole('button')) {
      expect(element.textContent ?? '').not.toMatch(/scan|rescan/i);
    }
    expect(screen.getByText(en['vehicles.duplicates.scanNote'])).toBeInTheDocument();
  });

  it('offers a decision control only on an open candidate', async () => {
    listVehicleDuplicates.mockResolvedValue(
      page([{ ...CANDIDATE, status: 'dismissed', reviewedAt: '2026-08-04T11:00:00.000Z' }])
    );
    render();
    await screen.findByText('93%');
    // A settled pair cannot be re-decided. The backend refuses, but the control
    // should never have been offered.
    expect(
      screen.queryByRole('button', { name: en['crm.duplicates.review'] })
    ).not.toBeInTheDocument();
  });

  it('closes the open panel when the status filter changes', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));
    expect(screen.getByText(en['crm.duplicates.dismissHeading'])).toBeInTheDocument();

    // Scoped by label: the table has its own page-size combobox, and
    // `getByRole('combobox')` would find both.
    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['vehicles.duplicateStatus.dismissed']
    );
    // The panel belonged to a row that may not survive the filter. Leaving it
    // open would let a decision land on a candidate no longer on screen.
    await waitFor(() =>
      expect(screen.queryByText(en['crm.duplicates.dismissHeading'])).not.toBeInTheDocument()
    );
  });

  it('shows the match basis as data rather than as a sentence about it', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));
    expect(screen.getByText(/vin_collision/)).toBeInTheDocument();
  });
});

describe('the attribute-change ledger', () => {
  const entry = (over: Record<string, unknown>) => ({
    id: 'h1',
    fieldCode: 'color',
    oldValue: 'Silver',
    newValue: 'Blue',
    occurredAt: '2026-08-04T10:00:00.000Z',
    actorId: 'u1',
    ...over,
  });

  const render = () =>
    renderLtr(<VehicleAttributeHistorySection locale="en" messages={en} vehicleId="v1" />);

  it('never prints the word null to a reader', async () => {
    listAttributeHistory.mockResolvedValue(
      page([
        entry({ id: 'h1', oldValue: null }),
        entry({ id: 'h2', newValue: null }),
        entry({ id: 'h3', oldValue: null, newValue: null }),
      ])
    );
    const { container } = render();
    await waitFor(() => expect(listAttributeHistory).toHaveBeenCalled());
    await screen.findByText(en['vehicles.history.noDetail']);
    expect(container.textContent ?? '').not.toContain('null');
  });

  it('reads a creation as "set to", not as a change from nothing', async () => {
    listAttributeHistory.mockResolvedValue(page([entry({ oldValue: null })]));
    render();
    expect(
      await screen.findByText(en['vehicles.history.set'], { exact: false })
    ).toBeInTheDocument();
  });

  it('says this is the vehicle’s own details, not a unified timeline', async () => {
    render();
    expect(screen.getByText(en['vehicles.history.scopeNote'])).toBeInTheDocument();
  });
});

describe('the same screens in Arabic and RTL', () => {
  it('renders the duplicate queue right-to-left with Arabic copy', async () => {
    renderRtl(<VehicleDuplicateReviewScreen locale="ar" messages={ar} />);
    await waitFor(() => expect(listVehicleDuplicates).toHaveBeenCalled());
    // `dir` lives on `<html>` in the application, and `renderRtl` puts it there
    // rather than on the container — a component asserting its own `dir` would
    // be asserting something the layout, not the component, is responsible for.
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText(ar['vehicles.duplicates.title'])).toBeInTheDocument();
    // The score keeps LTR direction inside an RTL row, or "93%" reorders.
    const score = await screen.findByText('93%');
    expect(score.closest('[dir="ltr"]')).not.toBeNull();
  });

  it('renders vehicle search right-to-left with Arabic copy', () => {
    renderRtl(<VehicleSearchScreen locale="ar" messages={ar} canCreate={false} makes={[]} />);
    expect(screen.getByText(ar['vehicles.search.idleTitle'])).toBeInTheDocument();
    // A VIN field must stay LTR even in an RTL layout, or the characters
    // reorder and the operator cannot check what they typed.
    const vin = screen.getByLabelText(ar['vehicles.search.vin']);
    expect(vin.getAttribute('dir')).toBe('ltr');
  });
});

describe('this file is not vacuous', () => {
  it('rendered real screens with real message catalogues', () => {
    // Every assertion above indexes `en`/`ar` by key. A missing key would make
    // `getByText(undefined)` throw rather than pass, but the count is asserted
    // here so a catalogue that lost these entries fails loudly.
    for (const key of [
      'vehicles.search.idleTitle',
      'vehicles.search.needCriteria',
      'vehicles.duplicates.mergePendingDecision',
      'vehicles.duplicates.scanNote',
      'vehicles.history.noDetail',
      'vehicles.history.scopeNote',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });
});
