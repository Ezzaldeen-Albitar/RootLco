import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { TEST_BRANCH, TEST_COMPANY, inBranch, renderLtr, renderRtl } from './render';
import type { CatalogueResult } from '@/features/vehicles/catalogue-api';

/** A healthy make catalogue — see the note in `vehicle-screens.dom.test.tsx`. */
const CATALOGUE_OK: CatalogueResult = {
  status: 'ok',
  options: [],
  truncated: false,
  correlationId: null,
};

/**
 * "I have not searched yet" and "I searched and found nothing" are different
 * facts (`P1-27-FE-002`).
 *
 * ## The defect
 *
 * `DataTable` chose between them with `isNarrowed(request)`, which reads
 * `request.filters` and `request.search`. Both search screens keep their
 * criteria OUTSIDE `TableRequest` — deliberately, so a customer's name never
 * reaches the address bar — and mount the table with `INITIAL_REQUEST`. So
 * `isNarrowed` was permanently false, and a search that matched nothing
 * announced:
 *
 *     Nothing here yet · Once records exist they will be listed here
 *
 * That is a claim about the tenant's entire customer list, made on the evidence
 * of one query that excluded everything. On the customer search it appeared
 * directly above the screen's own correct sentence, in a larger iconed heading —
 * so the false statement was the prominent one.
 *
 * ## What is asserted
 *
 * The wrong sentence is absent, the right one present, and the offered action is
 * the one that helps: create the record that was not found, gated on the
 * permission to create it. In both locales, because a mistranslated empty state
 * is still a wrong empty state.
 *
 * ## The work-order board's search inputs (P1-32)
 *
 * The board gained a number box and a free-text box. They are exercised here,
 * beside the other two search screens, because the claims are the same kind:
 * nothing is read while typing, Enter submits exactly what was typed beside the
 * required branch target, a one-character search is refused before a request,
 * an empty result is a statement about the search, and a denial is a denial.
 */

const searchCustomers = vi.fn();
const searchVehicles = vi.fn();
const listWorkOrders = vi.fn();

vi.mock('@/features/crm/customers/api', () => ({
  searchCustomers: (...a: unknown[]) => searchCustomers(...a),
}));
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...a: unknown[]) => searchVehicles(...a),
}));
vi.mock('@/features/work-orders/api', () => ({
  listWorkOrders: (...a: unknown[]) => listWorkOrders(...a),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { CustomerSearchScreen } =
  await import('@/features/crm/customers/components/CustomerSearchScreen');
const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');
const { WorkOrderQueueScreen } =
  await import('@/features/work-orders/components/WorkOrderQueueScreen');

const EMPTY_PAGE = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

beforeEach(() => {
  searchCustomers.mockReset();
  searchVehicles.mockReset();
  push.mockReset();
  searchCustomers.mockResolvedValue(EMPTY_PAGE);
  searchVehicles.mockResolvedValue(EMPTY_PAGE);
});

describe('the customer search distinguishes "not searched" from "no match"', () => {
  const render = (canCreate = true) =>
    renderLtr(<CustomerSearchScreen locale="en" messages={en} canCreate={canCreate} />);

  it('says nothing about results before a search is run', () => {
    const { container } = render();
    expect(screen.getByText(en['crm.customers.search.idleTitle'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['crm.customers.search.noMatch']);
    expect(text).not.toContain(en['state.noResults.title']);
  });

  it('does NOT claim the tenant has no customers after a search that matched none', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalled());

    expect(await screen.findByText(en['crm.customers.search.noMatch'])).toBeInTheDocument();
    // The sentence that was wrong. "Nothing here yet · Once records exist they
    // will be listed here" describes an empty tenant, not an empty result.
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['state.empty.title']);
    expect(text).not.toContain(en['state.empty.description']);
  });

  it('offers to create the customer that was not found', async () => {
    const user = userEvent.setup();
    render(true);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    expect(screen.getByTestId('add-individual-customer')).toBeInTheDocument();
    expect(screen.getByTestId('add-company-customer')).toBeInTheDocument();
  });

  it('offers nothing to an operator who may not create one', async () => {
    const user = userEvent.setup();
    render(false);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    // A control whose only outcome is a 403 is worse than no control.
    expect(screen.queryByTestId('add-individual-customer')).not.toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    const user = userEvent.setup();
    const { container } = renderRtl(<CustomerSearchScreen locale="ar" messages={ar} canCreate />);
    await user.type(screen.getByLabelText(ar['crm.customers.search.q']), 'Zzz{Enter}');
    expect(await screen.findByText(ar['crm.customers.search.noMatch'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ar['state.empty.title']);
  });
});

describe('the vehicle search distinguishes them as well', () => {
  const render = (canCreate = true) =>
    renderLtr(
      <VehicleSearchScreen locale="en" messages={en} canCreate={canCreate} makes={CATALOGUE_OK} />
    );

  it('says nothing about results before a search is run', () => {
    const { container } = render();
    expect(screen.getByText(en['vehicles.search.idleTitle'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(en['vehicles.search.noMatch']);
  });

  it('does NOT claim the tenant has no vehicles after a search that matched none', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await waitFor(() => expect(searchVehicles).toHaveBeenCalled());

    expect(await screen.findByText(en['vehicles.search.noMatch'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['state.empty.title']);
    expect(text).not.toContain(en['state.empty.description']);
  });

  it('offers to create the vehicle that was not found, when permitted', async () => {
    const user = userEvent.setup();
    render(true);
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await screen.findByText(en['vehicles.search.noMatch']);
    expect(screen.getByTestId('create-vehicle-from-no-results')).toBeInTheDocument();
  });

  it('offers nothing to an operator who may not create one', async () => {
    const user = userEvent.setup();
    render(false);
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await screen.findByText(en['vehicles.search.noMatch']);
    expect(screen.queryByTestId('create-vehicle-from-no-results')).not.toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    const user = userEvent.setup();
    const { container } = renderRtl(
      <VehicleSearchScreen locale="ar" messages={ar} canCreate makes={CATALOGUE_OK} />
    );
    await user.type(screen.getByLabelText(ar['vehicles.search.plate']), 'ZZ-9999{Enter}');
    expect(await screen.findByText(ar['vehicles.search.noMatch'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ar['state.empty.title']);
  });
});

describe('the work-order board searches by number and free text (P1-32)', () => {
  // The branch the board is addressed to, chosen once in the header.
  const COMPANY = TEST_COMPANY.id;
  const BRANCH = TEST_BRANCH.id;
  const ROW = {
    id: '33333333-3333-4333-8333-333333333333',
    companyId: COMPANY,
    branchId: BRANCH,
    receptionVisitId: '44444444-4444-4444-8444-444444444444',
    vehicleId: '55555555-5555-4555-8555-555555555555',
    kind: 'ordinary',
    state: 'open',
    partsForwardState: 'none',
    displayNumber: 'WO-000123',
    openedAt: '2026-09-01T09:30:00.000Z',
    recordVersion: 1,
    customer: null,
    vehicle: { registrationPlate: 'ABC-1234', makeModel: null },
  };

  beforeEach(() => {
    listWorkOrders.mockReset();
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE, rows: [ROW] });
  });

  const render = () => renderLtr(inBranch(<WorkOrderQueueScreen locale="en" messages={en} />));

  it('issues no request while typing', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['workOrders.queue.searchFilter']), 'Nadia');
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('submits number and search on Enter, as typed, beside the branch target', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['workOrders.queue.numberFilter']), 'WO-000123');
    await user.type(screen.getByLabelText(en['workOrders.queue.searchFilter']), 'ABC{Enter}');

    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    const [target, criteria] = listWorkOrders.mock.calls[0] as [unknown, unknown];
    expect(target).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(criteria).toEqual({ number: 'WO-000123', q: 'ABC' });
    expect(await screen.findByText('WO-000123')).toBeInTheDocument();
  });

  it('refuses a one-character search and says why, without a request', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['workOrders.queue.searchFilter']), 'A{Enter}');
    expect(await screen.findByText(en['workOrders.queue.searchTooShort'])).toBeInTheDocument();
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('echoes Arabic-Indic digits for reading and sends the number as typed', async () => {
    const user = userEvent.setup();
    renderRtl(inBranch(<WorkOrderQueueScreen locale="ar" messages={ar} />, { locale: 'ar' }));
    const box = screen.getByLabelText(ar['workOrders.queue.numberFilter']);
    await user.type(box, '١٢٣');
    expect(screen.getByTestId('digits-echo')).toHaveTextContent('123');
    await user.type(box, '{Enter}');
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    const [, criteria] = listWorkOrders.mock.calls[0] as [unknown, { number?: string }];
    expect(criteria.number).toBe('١٢٣');
  });

  it('states an empty result as a statement about the search', async () => {
    listWorkOrders.mockResolvedValue(EMPTY_PAGE);
    const user = userEvent.setup();
    const { container } = render();
    await user.type(screen.getByLabelText(en['workOrders.queue.searchFilter']), 'zz{Enter}');
    expect(await screen.findByText(en['workOrders.queue.noneMatching'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(en['state.empty.title']);
  });

  it('renders a denial as a denial, not as an empty board', async () => {
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE, status: 'denied' });
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['workOrders.queue.searchFilter']), 'zz{Enter}');
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('asserts against the exact sentences the defect produced', () => {
    // If these keys ever disappear the `not.toContain` assertions above would
    // pass against `undefined` and prove nothing.
    for (const key of ['state.empty.title', 'state.empty.description', 'state.noResults.title']) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
    expect(en['state.empty.title']).not.toBe(en['crm.customers.search.noMatch']);
  });
});
