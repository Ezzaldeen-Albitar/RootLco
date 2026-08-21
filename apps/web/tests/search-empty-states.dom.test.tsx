import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
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
 */

const searchCustomers = vi.fn();
const searchVehicles = vi.fn();

vi.mock('@/features/crm/customers/api', () => ({
  searchCustomers: (...a: unknown[]) => searchCustomers(...a),
}));
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...a: unknown[]) => searchVehicles(...a),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { CustomerSearchScreen } =
  await import('@/features/crm/customers/components/CustomerSearchScreen');
const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');

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
    await user.type(screen.getByLabelText(en['crm.customers.search.name']), 'Zzz{Enter}');
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
    await user.type(screen.getByLabelText(en['crm.customers.search.name']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    expect(screen.getByTestId('add-individual-customer')).toBeInTheDocument();
    expect(screen.getByTestId('add-company-customer')).toBeInTheDocument();
  });

  it('offers nothing to an operator who may not create one', async () => {
    const user = userEvent.setup();
    render(false);
    await user.type(screen.getByLabelText(en['crm.customers.search.name']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    // A control whose only outcome is a 403 is worse than no control.
    expect(screen.queryByTestId('add-individual-customer')).not.toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    const user = userEvent.setup();
    const { container } = renderRtl(<CustomerSearchScreen locale="ar" messages={ar} canCreate />);
    await user.type(screen.getByLabelText(ar['crm.customers.search.name']), 'Zzz{Enter}');
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
