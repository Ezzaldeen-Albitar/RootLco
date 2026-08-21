import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Walk-in customer and vehicle intake (`P1-28-FE-006`, `TC-P1-28-XD-001`).
 *
 * The claims that matter most here:
 *
 *   1. **The phone degradation is stated on screen, in both languages**
 *      (`G-CRM-PHONE`). The first thing a receptionist tries is the caller's
 *      phone number; the platform's customer directory cannot search by it,
 *      and a search that silently returns nothing teaches the operator the
 *      customer does not exist.
 *   2. **The customer-first vehicle pick is real** — the customer's own
 *      vehicle list is read through `crm.customer-vehicle-list`, a vehicle
 *      chosen from it needs no relationship step, and a relationship row
 *      whose vehicle record is gone cannot be chosen.
 *   3. **The duplicate guards are the contracts', not inventions**: customer
 *      creation surfaces `possibleDuplicates` from the creation RESPONSE with
 *      a real switch-to-existing decision, and a vehicle-create 409 renders
 *      the honest "already in use" copy plus the way out (find it instead).
 *   4. **The handoff is truthful**: no link to the check-in wizard exists
 *      until the wizard's route does.
 */

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles', () => ({
  listCustomerVehicles: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const createIndividualAction = vi.fn();
const createCompanyAction = vi.fn();
vi.mock('@/features/crm/customers/creation-actions', () => ({
  createIndividualAction: (...args: unknown[]) => createIndividualAction(...args),
  createCompanyAction: (...args: unknown[]) => createCompanyAction(...args),
}));

const searchVehicles = vi.fn();
const createVehicleAction = vi.fn();
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...args: unknown[]) => searchVehicles(...args),
  createVehicleAction: (...args: unknown[]) => createVehicleAction(...args),
}));

const linkCustomerAction = vi.fn();
vi.mock('@/features/vehicles/relations-api', () => ({
  linkCustomerAction: (...args: unknown[]) => linkCustomerAction(...args),
}));

const { WalkInIntakeScreen } =
  await import('@/features/receptions/intake/components/WalkInIntakeScreen');
const { checkInWizardHref } = await import('@/features/receptions/intake/intake-handoff');

const CUSTOMER_ID = '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479';
const CREATED_CUSTOMER_ID = '0aa1b2c3-d4e5-4f60-8172-9e8d7c6b5a40';
const DUPLICATE_ID = '11112222-3333-4444-8555-666677778888';
const VEHICLE_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const SEARCHED_VEHICLE_ID = 'b2c3d4e5-1111-4111-8111-111111111111';
const CREATED_VEHICLE_ID = 'c3d4e5f6-2222-4222-8222-222222222222';

const CUSTOMER_HIT = {
  id: CUSTOMER_ID,
  displayNumber: 'C-000482',
  displayName: 'Layla Haddad',
  partyType: 'individual',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** An OPEN relationship to a live vehicle — choosable, already linked. */
const OWN_VEHICLE = {
  id: 'd4e5f6a7-3333-4333-8333-333333333333',
  vehicleId: VEHICLE_ID,
  relationshipRole: 'owner',
  validFrom: '2026-01-01',
  validTo: null,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  vehicleDisplayNumber: 'V-0007',
  vin: '1HGCM82633A004352',
  makeId: null,
  modelId: null,
  modelYear: 2019,
  color: null,
  vehicleLifecycleStatus: 'active',
};

/** A relationship row that outlived its vehicle — identity nulls AS A GROUP. */
const DEAD_VEHICLE_ROW = {
  id: 'e5f6a7b8-4444-4444-8444-444444444444',
  vehicleId: 'f6a7b8c9-5555-4555-8555-555555555555',
  relationshipRole: 'user',
  validFrom: '2024-01-01',
  validTo: '2025-01-01',
  active: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  vehicleDisplayNumber: null,
  vin: null,
  makeId: null,
  modelId: null,
  modelYear: null,
  color: null,
  vehicleLifecycleStatus: null,
};

const SEARCH_HIT = {
  id: SEARCHED_VEHICLE_ID,
  displayNumber: 'V-0100',
  vin: '2HGCM82633A004999',
  makeId: null,
  modelId: null,
  modelYear: 2021,
  powertrainCategory: 'ice',
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  mergedIntoId: null,
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

function createdCustomer(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    messageKey: 'crm.customers.create.created',
    attempt: 1,
    created: {
      customerId: CREATED_CUSTOMER_ID,
      displayNumber: 'C-000900',
      partyType: 'individual',
      lifecycleStatus: 'prospect',
      possibleDuplicates: [],
      ...overrides,
    },
  };
}

type ScreenProps = Parameters<typeof WalkInIntakeScreen>[0];

function props(overrides: Partial<ScreenProps> = {}): ScreenProps {
  return {
    locale: 'en',
    messages: en,
    canCreateCustomer: true,
    canSearchVehicles: true,
    canCreateVehicle: true,
    canLinkVehicle: true,
    checkInAvailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  searchCustomerDirectory.mockReset();
  listCustomerVehicles.mockReset();
  createIndividualAction.mockReset();
  createCompanyAction.mockReset();
  searchVehicles.mockReset();
  createVehicleAction.mockReset();
  linkCustomerAction.mockReset();

  searchCustomerDirectory.mockResolvedValue(page([CUSTOMER_HIT]));
  listCustomerVehicles.mockResolvedValue(page([OWN_VEHICLE, DEAD_VEHICLE_ROW]));
  searchVehicles.mockResolvedValue(page([SEARCH_HIT]));
  createIndividualAction.mockResolvedValue(createdCustomer());
  createCompanyAction.mockResolvedValue(createdCustomer({ partyType: 'organization' }));
  createVehicleAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.create.created',
    attempt: 1,
    created: {
      vehicleId: CREATED_VEHICLE_ID,
      lifecycleStatus: 'draft',
      powertrainCategory: 'ice',
      hasVin: true,
    },
  });
  linkCustomerAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.relationships.linked',
    attempt: 1,
  });
});

/** Search for the fixture customer and choose them. */
async function chooseCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Layla');
  await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
  await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));
  // The vehicle step reads the customer's own vehicles on entry.
  await screen.findByText(en['receptions.intake.vehicle.ownListTitle']);
}

describe('the stated phone degradation (G-CRM-PHONE)', () => {
  it('states beside the search controls, in English, that phone search is not available', () => {
    renderLtr(<WalkInIntakeScreen {...props()} />);
    const notice = screen.getByTestId('phone-search-notice');
    expect(notice).toHaveTextContent(en['receptions.intake.phone.title']);
    expect(notice).toHaveTextContent(en['receptions.intake.phone.body']);
  });

  it('states it in Arabic for the Arabic interface', () => {
    renderRtl(<WalkInIntakeScreen {...props({ locale: 'ar', messages: ar })} />);
    const notice = screen.getByTestId('phone-search-notice');
    expect(notice).toHaveTextContent(ar['receptions.intake.phone.title']);
    expect(notice).toHaveTextContent(ar['receptions.intake.phone.body']);
  });

  it('offers no phone search box to fail silently', () => {
    renderLtr(<WalkInIntakeScreen {...props()} />);
    // The two search boxes are name and reference — nothing labelled phone.
    expect(screen.queryByLabelText(en['field.phone'])).not.toBeInTheDocument();
  });
});

describe('finding the customer', () => {
  it('advances to the vehicle step once a customer is chosen, and shows who', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    expect(screen.getByText('Layla Haddad')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: en['receptions.intake.customer.change'] })
    ).toBeInTheDocument();
  });

  it('resets the vehicle step when the customer is changed', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    await user.click(screen.getByRole('button', { name: en['receptions.intake.customer.change'] }));
    expect(screen.getByText(en['receptions.intake.customer.heading'])).toBeInTheDocument();
    expect(
      screen.queryByText(en['receptions.intake.vehicle.ownListTitle'])
    ).not.toBeInTheDocument();
  });

  it('hides both create paths from an operator without the create permission', () => {
    renderLtr(<WalkInIntakeScreen {...props({ canCreateCustomer: false })} />);
    expect(
      screen.queryByRole('button', { name: en['crm.customers.create.individualTitle'] })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en['crm.customers.create.companyTitle'] })
    ).not.toBeInTheDocument();
  });
});

describe('creating the customer, and its duplicate guard', () => {
  it('creates an individual and continues with the new record', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);

    await user.click(
      screen.getByRole('button', { name: en['crm.customers.create.individualTitle'] })
    );
    await user.type(screen.getByLabelText(/Given name/), 'Layla');
    await user.type(screen.getByLabelText(/Family name/), 'Haddad');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await screen.findByText(en['crm.customers.create.created'], { exact: false });
    expect(createIndividualAction).toHaveBeenCalledTimes(1);
    const form = createIndividualAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('givenName')).toBe('Layla');
    expect(form.get('familyName')).toBe('Haddad');

    await user.click(
      screen.getByRole('button', { name: en['receptions.intake.customer.continueCreated'] })
    );
    await screen.findByText(en['receptions.intake.vehicle.ownListTitle']);
    // The flow continues with the CREATED customer's list, not somebody else's.
    expect(listCustomerVehicles.mock.calls[0]?.[0]).toBe(CREATED_CUSTOMER_ID);
  });

  it('surfaces the possibleDuplicates advisory and can switch to the existing customer', async () => {
    createIndividualAction.mockResolvedValue(
      createdCustomer({
        possibleDuplicates: [
          { id: DUPLICATE_ID, displayName: 'Layla Haddad', displayNumber: 'C-000482' },
        ],
      })
    );
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);

    await user.click(
      screen.getByRole('button', { name: en['crm.customers.create.individualTitle'] })
    );
    await user.type(screen.getByLabelText(/Given name/), 'Layla');
    await user.type(screen.getByLabelText(/Family name/), 'Haddad');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    // The record WAS created — the advisory must not read as a rejection.
    await screen.findByText(en['crm.customers.create.created'], { exact: false });
    expect(screen.getByText(en['crm.customers.create.duplicatesTitle'])).toBeInTheDocument();
    expect(screen.getByText(en['receptions.intake.customer.duplicatesBody'])).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: en['receptions.intake.customer.useExisting'] })
    );
    await screen.findByText(en['receptions.intake.vehicle.ownListTitle']);
    // Continuing with the EXISTING record, not the one just created.
    expect(listCustomerVehicles.mock.calls[0]?.[0]).toBe(DUPLICATE_ID);
  });
});

describe('the customer-first vehicle pick (crm.customer-vehicle-list)', () => {
  it('lists the customer’s vehicles and completes without a relationship step', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText('V-0007');

    await user.click(
      within(list).getByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    );

    // Already on record against this customer — no link step, straight to done.
    await screen.findByText(en['receptions.intake.done.heading']);
    expect(screen.getByText(en['receptions.intake.done.linkExisting'])).toBeInTheDocument();
    expect(linkCustomerAction).not.toHaveBeenCalled();
  });

  it('cannot choose a relationship row whose vehicle record is gone', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText(en['receptions.intake.vehicle.noLiveVehicle']);
    // Exactly ONE choose control: the live row. The dead row offers none.
    expect(
      within(list).getAllByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    ).toHaveLength(1);
  });
});

describe('searching all vehicles, then recording the relationship', () => {
  async function chooseSearchedVehicle(user: ReturnType<typeof userEvent.setup>) {
    await chooseCustomer(user);
    const search = screen.getByTestId('intake-vehicle-search');
    await user.type(within(search).getByLabelText(en['vehicles.search.vin']), SEARCH_HIT.vin);
    await user.click(within(search).getByRole('button', { name: en['vehicles.search.submit'] }));
    const results = await screen.findByTestId('intake-vehicle-search-results');
    await within(results).findByText('V-0100');
    await user.click(
      within(results).getByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    );
    await screen.findByTestId('intake-link-step');
  }

  it('links the chosen customer to the searched vehicle in the chosen role', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseSearchedVehicle(user);

    await user.selectOptions(
      screen.getByLabelText(en['vehicles.relationships.role'], { exact: false }),
      'owner'
    );
    await user.click(screen.getByRole('button', { name: en['receptions.intake.link.submit'] }));

    await screen.findByText(en['receptions.intake.done.heading']);
    expect(screen.getByText(en['receptions.intake.done.linkRecorded'])).toBeInTheDocument();

    expect(linkCustomerAction).toHaveBeenCalledTimes(1);
    // Bound to the VEHICLE; the customer travels as the hidden partner field.
    expect(linkCustomerAction.mock.calls[0]?.[0]).toBe(SEARCHED_VEHICLE_ID);
    const form = linkCustomerAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('partnerId')).toBe(CUSTOMER_ID);
    expect(form.get('relationshipRole')).toBe('owner');
  });

  it('can continue without recording, and says so on the summary', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseSearchedVehicle(user);

    await user.click(screen.getByRole('button', { name: en['receptions.intake.link.skip'] }));
    await screen.findByText(en['receptions.intake.done.heading']);
    expect(screen.getByText(en['receptions.intake.done.linkSkipped'])).toBeInTheDocument();
    expect(linkCustomerAction).not.toHaveBeenCalled();
  });

  it('states the missing permission instead of hiding the relationship step', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props({ canLinkVehicle: false })} />);
    await chooseSearchedVehicle(user);

    expect(screen.getByTestId('intake-link-denied')).toHaveTextContent(
      en['receptions.intake.link.notPermitted']
    );
    await user.click(screen.getByRole('button', { name: en['receptions.intake.link.continue'] }));
    await screen.findByText(en['receptions.intake.done.heading']);
    expect(screen.getByText(en['receptions.intake.done.linkNotPermitted'])).toBeInTheDocument();
  });

  it('hides the search section from an operator without vehicle read access', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props({ canSearchVehicles: false })} />);
    await chooseCustomer(user);
    expect(screen.queryByTestId('intake-vehicle-search')).not.toBeInTheDocument();
  });

  it('states the boundary when neither search nor create is available', async () => {
    const user = userEvent.setup();
    renderLtr(
      <WalkInIntakeScreen {...props({ canSearchVehicles: false, canCreateVehicle: false })} />
    );
    await chooseCustomer(user);
    expect(screen.getByText(en['receptions.intake.vehicle.limitedAccess'])).toBeInTheDocument();
  });
});

describe('registering a new vehicle, and its duplicate guard', () => {
  it('creates a draft vehicle and moves to the relationship step', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const create = screen.getByTestId('intake-vehicle-create');
    // `exact: false`, because the label carries the shared "(optional)" marker.
    await user.type(
      within(create).getByLabelText(en['vehicles.create.vin'], { exact: false }),
      '2hgcm82633a004999'
    );
    await user.click(within(create).getByRole('button', { name: en['vehicles.create.submit'] }));

    await screen.findByTestId('intake-link-step');
    expect(createVehicleAction).toHaveBeenCalledTimes(1);
    const form = createVehicleAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('vin')).toBe('2hgcm82633a004999');
  });

  it('renders the honest 409 copy and points at the search instead of guessing the field', async () => {
    createVehicleAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'vehicles.create.conflict',
      attempt: 1,
      correlationId: 'conflict-correlation-id',
    });
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const create = screen.getByTestId('intake-vehicle-create');
    await user.type(
      within(create).getByLabelText(en['vehicles.create.vin'], { exact: false }),
      '2HGCM82633A004999'
    );
    await user.click(within(create).getByRole('button', { name: en['vehicles.create.submit'] }));

    // The contract cannot say WHICH value collided (two unique constraints,
    // one error code), so neither does the copy — and the way out is offered.
    await screen.findByText(en['vehicles.create.conflict']);
    expect(screen.getByText(en['receptions.intake.vehicle.conflictFindIt'])).toBeInTheDocument();
    expect(screen.getByText('conflict-correlation-id')).toBeInTheDocument();
    // Still on the vehicle step: nothing was chosen.
    expect(screen.queryByTestId('intake-link-step')).not.toBeInTheDocument();
  });

  it('hides the create section from an operator without vehicle manage access', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props({ canCreateVehicle: false })} />);
    await chooseCustomer(user);
    expect(screen.queryByTestId('intake-vehicle-create')).not.toBeInTheDocument();
  });
});

describe('the truthful handoff', () => {
  async function completeQuickest(user: ReturnType<typeof userEvent.setup>) {
    await chooseCustomer(user);
    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText('V-0007');
    await user.click(
      within(list).getByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    );
    await screen.findByText(en['receptions.intake.done.heading']);
  }

  it('states that check-in is not available yet, with no link to a 404', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props({ checkInAvailable: false })} />);
    await completeQuickest(user);

    expect(screen.getByText(en['receptions.intake.done.wizardPending'])).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: en['receptions.intake.done.continue'] })
    ).not.toBeInTheDocument();
    // The pair is still usable: both real pages are linked.
    expect(
      screen.getByRole('link', { name: en['receptions.intake.done.openCustomer'] })
    ).toHaveAttribute('href', `/en/crm/customers/${CUSTOMER_ID}`);
    expect(
      screen.getByRole('link', { name: en['receptions.intake.done.openVehicle'] })
    ).toHaveAttribute('href', `/en/vehicles/${VEHICLE_ID}`);
  });

  it('links to the wizard with the exact handoff pair once the route exists', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props({ checkInAvailable: true })} />);
    await completeQuickest(user);

    const href = screen
      .getByRole('link', { name: en['receptions.intake.done.continue'] })
      .getAttribute('href');
    expect(href).toBe(checkInWizardHref('en', { customerId: CUSTOMER_ID, vehicleId: VEHICLE_ID }));
    /*
     * And the LITERAL address, spelled out. Comparing the rendered link only to
     * the builder that produced it agrees with itself no matter what the
     * builder says — which is exactly how `/reception/check-in` (singular) sat
     * in `CHECK_IN_WIZARD_PATH` while the wizard was mounted at
     * `/receptions/check-in`. `reception-walkin-handoff.test.ts` pins the same
     * segment to the directory that exists on disk.
     */
    expect(href).toBe(`/en/receptions/check-in?customerId=${CUSTOMER_ID}&vehicleId=${VEHICLE_ID}`);
    expect(screen.queryByText(en['receptions.intake.done.wizardPending'])).not.toBeInTheDocument();
  });

  it('starts a fresh intake from the summary', async () => {
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await completeQuickest(user);

    await user.click(screen.getByRole('button', { name: en['receptions.intake.done.startOver'] }));
    expect(screen.getByText(en['receptions.intake.customer.heading'])).toBeInTheDocument();
  });
});

describe('the Arabic flow end to end', () => {
  it('completes the customer-first path entirely in Arabic', async () => {
    const user = userEvent.setup();
    renderRtl(<WalkInIntakeScreen {...props({ locale: 'ar', messages: ar })} />);

    await user.type(screen.getByLabelText(ar['crm.customers.column.name']), 'Layla');
    await user.click(screen.getByRole('button', { name: ar['customerSelector.search'] }));
    await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));

    await screen.findByText(ar['receptions.intake.vehicle.ownListTitle']);
    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText('V-0007');
    await user.click(
      within(list).getByRole('button', { name: ar['receptions.intake.vehicle.choose'] })
    );

    await screen.findByText(ar['receptions.intake.done.heading']);
    expect(screen.getByText(ar['receptions.intake.done.linkExisting'])).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('failure states carry the reference and offer only honest retries', () => {
  it('renders the denied state when the vehicle list read is refused', async () => {
    listCustomerVehicles.mockResolvedValue(
      page([], { status: 'denied', correlationId: 'denied-correlation-id' })
    );
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText(en['state.denied.title']);
  });

  it('offers Retry on an unavailable read, and re-reads on it', async () => {
    listCustomerVehicles.mockResolvedValue(
      page([], { status: 'unavailable', correlationId: 'unavailable-correlation-id' })
    );
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await chooseCustomer(user);

    const list = screen.getByTestId('customer-vehicle-list');
    await within(list).findByText(en['state.unavailable.title']);
    expect(within(list).getByText('unavailable-correlation-id')).toBeInTheDocument();

    listCustomerVehicles.mockResolvedValue(page([OWN_VEHICLE]));
    await user.click(within(list).getByRole('button', { name: en['state.retry'] }));
    await within(list).findByText('V-0007');
  });
});
