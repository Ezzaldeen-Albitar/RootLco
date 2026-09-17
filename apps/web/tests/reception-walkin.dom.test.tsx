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
 *   1. **Phone search is real** (P1-32, closing `G-CRM-PHONE`). The first thing
 *      a receptionist tries is the caller's phone number; the picker sends it
 *      as typed and shows the matched phone exactly as the backend returned
 *      it, partly hidden when it is masked.
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

/*
 * The two reads the customer-first step makes to state WHICH vehicle Continue
 * carries: the vehicle record and its current plate (both `veh.vehicle.read`).
 */
const readVehicleSummary = vi.fn();
vi.mock('@/features/receptions/support-api', () => ({
  readVehicleSummary: (...args: unknown[]) => readVehicleSummary(...args),
}));
const listPlates = vi.fn();
vi.mock('@/features/vehicles/history-api', () => ({
  listPlates: (...args: unknown[]) => listPlates(...args),
}));

/*
 * The customer profile's own reads, mocked because the last three blocks of
 * this file exercise the entry point the profile offers into this same flow
 * (`P1-32-PRE-077`). A mock that is missing an export throws asynchronously
 * into an unrelated test, so this stays a superset of what the screen imports.
 */
const emptyProfilePage = async () => ({
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
});
vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: vi.fn(),
  listContacts: emptyProfilePage,
  listAddresses: emptyProfilePage,
  listPreferences: emptyProfilePage,
  listConsents: emptyProfilePage,
  listNotes: async () => ({ ...(await emptyProfilePage()), includesRestricted: true }),
  listAlerts: emptyProfilePage,
  listTags: emptyProfilePage,
  listRestrictions: emptyProfilePage,
}));
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: emptyProfilePage,
  listDuplicates: emptyProfilePage,
  reviewDuplicateAction: vi.fn(),
}));

const { WalkInIntakeScreen } =
  await import('@/features/receptions/intake/components/WalkInIntakeScreen');
const { checkInWizardHref } = await import('@/features/receptions/intake/intake-handoff');
const { CustomerWorkOrderStartScreen } =
  await import('@/features/receptions/intake/components/CustomerWorkOrderStartScreen');
const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');
type CustomerDetail = Parameters<typeof CustomerProfileScreen>[0]['customer'];

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

/** What `veh.vehicle-read` answers for each fixture vehicle. */
function vehicleSummary(vehicleId: string) {
  const known: Record<string, { displayNumber: string | null; vin: string | null }> = {
    [VEHICLE_ID]: { displayNumber: 'V-0007', vin: '1HGCM82633A004352' },
    [SEARCHED_VEHICLE_ID]: { displayNumber: 'V-0100', vin: '2HGCM82633A004999' },
    [CREATED_VEHICLE_ID]: { displayNumber: 'V-0200', vin: '2HGCM82633A004999' },
  };
  return {
    id: vehicleId,
    displayNumber: known[vehicleId]?.displayNumber ?? null,
    vin: known[vehicleId]?.vin ?? null,
    makeName: 'Honda',
    modelName: 'Accord',
    modelYear: 2021,
    color: null,
    lifecycleStatus: 'active',
    workshopStatus: 'none',
    mergedIntoId: null,
  };
}

/** A plate that is still open, and one that was closed; only the first is current. */
const CURRENT_PLATE = {
  id: '5d6e7f80-6666-4666-8666-666666666666',
  countryCode: 'JO',
  plate: '12-34567',
  validFrom: '2026-02-01',
  validTo: null,
  active: true,
  createdAt: '2026-02-01T00:00:00.000Z',
};
const ENDED_PLATE = {
  ...CURRENT_PLATE,
  id: '6e7f8091-7777-4777-8777-777777777777',
  plate: '99-00001',
  validTo: '2026-02-01',
  active: false,
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
  readVehicleSummary.mockReset();
  listPlates.mockReset();

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
  readVehicleSummary.mockImplementation(async (vehicleId: string) => ({
    status: 'ok',
    data: vehicleSummary(vehicleId),
    correlationId: 'fixed-correlation-id',
  }));
  listPlates.mockResolvedValue(page([ENDED_PLATE, CURRENT_PLATE]));
});

/** Search for the fixture customer and choose them. */
async function chooseCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Layla');
  await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
  await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));
  // The vehicle step reads the customer's own vehicles on entry.
  await screen.findByText(en['receptions.intake.vehicle.ownListTitle']);
}

describe('searching for the caller by phone (P1-32, closing G-CRM-PHONE)', () => {
  const MASKED_HIT = { ...CUSTOMER_HIT, primaryPhone: '*******4567', phoneMasked: true };

  it('offers a phone box and no longer states that phone search is missing', () => {
    renderLtr(<WalkInIntakeScreen {...props()} />);
    expect(screen.getByLabelText(en['customerSelector.phone'])).toBeInTheDocument();
    expect(screen.queryByTestId('phone-search-notice')).not.toBeInTheDocument();
  });

  it('sends the typed phone number as the phone criterion and shows the masked result', async () => {
    searchCustomerDirectory.mockResolvedValue(page([MASKED_HIT]));
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);

    // Enter searches; it must not submit anything else.
    await user.type(screen.getByLabelText(en['customerSelector.phone']), '0791234567{Enter}');

    expect(await screen.findByText('*******4567')).toBeInTheDocument();
    expect(searchCustomerDirectory).toHaveBeenCalledTimes(1);
    const [, , criteria] = searchCustomerDirectory.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(criteria).toEqual({ phone: '0791234567' });
    // Shown exactly as returned, with the plain-language hint beside it.
    const choice = screen.getByRole('button', { name: /Layla Haddad/ });
    expect(within(choice).getByText(en['crm.customers.search.phonePartlyHidden'])).toBeVisible();
  });

  it('sends Arabic-Indic digits as typed, and only echoes the Western form for reading', async () => {
    const user = userEvent.setup();
    renderRtl(<WalkInIntakeScreen {...props({ locale: 'ar', messages: ar })} />);
    const box = screen.getByLabelText(ar['customerSelector.phone']);
    await user.type(box, '٠٧٩١٢٣٤٥٦٧');

    expect(screen.getByTestId('digits-echo')).toHaveTextContent('0791234567');
    await user.type(box, '{Enter}');
    await screen.findByText('Layla Haddad');
    const [, , criteria] = searchCustomerDirectory.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(criteria).toEqual({ phone: '٠٧٩١٢٣٤٥٦٧' });
  });

  it('does not show the partly-hidden hint when the phone is shown whole', async () => {
    searchCustomerDirectory.mockResolvedValue(
      page([{ ...CUSTOMER_HIT, primaryPhone: '0791234567', phoneMasked: false }])
    );
    const user = userEvent.setup();
    renderLtr(<WalkInIntakeScreen {...props()} />);
    await user.type(screen.getByLabelText(en['customerSelector.phone']), '1234567{Enter}');
    expect(await screen.findByText('0791234567')).toBeInTheDocument();
    expect(screen.queryByText(en['crm.customers.search.phonePartlyHidden'])).toBeNull();
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

/**
 * The customer-first route into the same flow (`P1-32-PRE-077`).
 *
 * The Owner's requirement of 2026-09-17: a customer already on screen should
 * not have to be searched for again. The profile offers the entry point, the
 * step that follows asks only for the vehicle, and nothing proceeds without
 * one. The claims pinned below are that set, plus the two the step must not
 * weaken — no work order or reception record is created here, and the way
 * onward is the EXISTING handoff rather than a second one.
 */

const PROFILE_CUSTOMER: CustomerDetail = {
  id: CUSTOMER_ID,
  displayNumber: 'C-000482',
  displayName: 'Layla Haddad',
  partyType: 'individual',
  lifecycleStatus: 'active',
  commercialStatus: 'normal',
  recordVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  givenName: 'Layla',
  familyName: 'Haddad',
  preferredLocale: 'ar',
  legalName: null,
  tradeName: null,
};

/** An ENDED relationship to a vehicle that still exists — history, not a pick. */
const ENDED_LINK = {
  ...OWN_VEHICLE,
  id: '7a8b9c0d-8888-4888-8888-888888888888',
  vehicleId: '8b9c0d1e-9999-4999-8999-999999999999',
  validTo: '2026-03-01',
  active: false,
  vehicleDisplayNumber: 'V-0008',
};

type StepProps = Parameters<typeof CustomerWorkOrderStartScreen>[0];

function stepProps(overrides: Partial<StepProps> = {}): StepProps {
  return {
    locale: 'en',
    messages: en,
    customer: {
      id: CUSTOMER_ID,
      displayName: PROFILE_CUSTOMER.displayName,
      displayNumber: PROFILE_CUSTOMER.displayNumber,
      partyType: PROFILE_CUSTOMER.partyType,
    },
    canSearchVehicles: true,
    canCreateVehicle: true,
    canLinkVehicle: true,
    ...overrides,
  };
}

describe('the entry point on the customer profile', () => {
  it('offers the action to a session that may open a reception visit', () => {
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={PROFILE_CUSTOMER}
        canStartWorkOrder={true}
      />
    );

    expect(
      screen.getByRole('link', { name: en['crm.customers.profile.newWorkOrder'] })
    ).toHaveAttribute('href', `/en/crm/customers/${CUSTOMER_ID}/work-order/new`);
  });

  it('hides the action from a session that may not', () => {
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={PROFILE_CUSTOMER}
        canStartWorkOrder={false}
      />
    );

    expect(
      screen.queryByRole('link', { name: en['crm.customers.profile.newWorkOrder'] })
    ).not.toBeInTheDocument();
  });

  it('hides the action when the caller states nothing at all', () => {
    // The default is the safe one: no action rather than a route that denies.
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={PROFILE_CUSTOMER} />);

    expect(screen.queryByTestId('customer-new-work-order')).not.toBeInTheDocument();
  });

  it('offers it in Arabic too', () => {
    renderRtl(
      <CustomerProfileScreen
        locale="ar"
        messages={ar}
        customer={PROFILE_CUSTOMER}
        canStartWorkOrder={true}
      />
    );

    expect(
      screen.getByRole('link', { name: ar['crm.customers.profile.newWorkOrder'] })
    ).toHaveAttribute('href', `/ar/crm/customers/${CUSTOMER_ID}/work-order/new`);
  });
});

describe('the vehicle step that follows the customer profile', () => {
  it('states the preselected customer and offers no way to change them', async () => {
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    const fixed = screen.getByTestId('work-order-start-customer');
    expect(fixed).toHaveTextContent('Layla Haddad');
    expect(fixed).toHaveTextContent('C-000482');
    expect(fixed).toHaveTextContent(en['receptions.workOrderStart.customerFixed']);
    expect(
      screen.queryByRole('button', { name: en['receptions.intake.customer.change'] })
    ).not.toBeInTheDocument();
    // Never the identifier where a reference belongs.
    expect(fixed).not.toHaveTextContent(CUSTOMER_ID);

    await screen.findByRole('radio');
  });

  it('reads that customer and offers the CURRENT relationships only', async () => {
    listCustomerVehicles.mockResolvedValue(page([OWN_VEHICLE, ENDED_LINK, DEAD_VEHICLE_ROW]));
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    const choices = await screen.findAllByRole('radio');
    expect(choices).toHaveLength(1);
    expect(screen.getByText('V-0007')).toBeVisible();
    expect(screen.queryByText('V-0008')).not.toBeInTheDocument();

    const [customerId] = listCustomerVehicles.mock.calls[0] as [string];
    expect(customerId).toBe(CUSTOMER_ID);
  });

  it('shows the loading state before the list answers', () => {
    listCustomerVehicles.mockReturnValue(new Promise(() => {}));
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(screen.getByText(en['state.loading'])).toBeInTheDocument();
  });

  it('offers the existing find-or-add path when no vehicle fits', async () => {
    listCustomerVehicles.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByTestId('work-order-start-empty')).toHaveTextContent(
      en['receptions.workOrderStart.empty']
    );

    await user.click(screen.getByTestId('work-order-start-add'));

    // The EXISTING intake step, not a second one: its own search and register
    // panels are what appears.
    expect(await screen.findByTestId('intake-vehicle-search')).toBeInTheDocument();
    expect(screen.getByTestId('intake-vehicle-create')).toBeInTheDocument();
  });

  it('states the boundary instead of the add path when the operator may not add', async () => {
    listCustomerVehicles.mockResolvedValue(page([]));
    renderLtr(
      <CustomerWorkOrderStartScreen
        {...stepProps({ canSearchVehicles: false, canCreateVehicle: false, canLinkVehicle: false })}
      />
    );

    expect(await screen.findByTestId('work-order-start-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('work-order-start-add')).not.toBeInTheDocument();
    expect(screen.getByText(en['receptions.intake.vehicle.limitedAccess'])).toBeVisible();
  });

  it('says an emptied page is an emptied page, and keeps the pager', async () => {
    /*
     * The filter runs on the fetched page, so a customer whose first page holds
     * only history has an EMPTY page and not an empty history. The screen said
     * "no vehicle is recorded for this customer" beside a Next button that
     * would have found one, which is two wrong things at once: a claim about
     * the customer made from one page, and an invitation to add a vehicle they
     * may already have.
     */
    listCustomerVehicles.mockResolvedValue(
      page([ENDED_LINK, DEAD_VEHICLE_ROW], { hasMore: true, nextCursor: 'the-next-cursor' })
    );
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByTestId('work-order-start-empty')).toHaveTextContent(
      en['receptions.workOrderStart.emptyOnThisPage']
    );
    expect(screen.queryByText(en['receptions.workOrderStart.empty'])).not.toBeInTheDocument();
    // The way to the rest of the list stays where it was.
    expect(screen.getByRole('button', { name: en['table.nextPage'] })).toBeEnabled();
  });

  it('says no vehicle is recorded only when there is no further page', async () => {
    listCustomerVehicles.mockResolvedValue(page([ENDED_LINK]));
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByTestId('work-order-start-empty')).toHaveTextContent(
      en['receptions.workOrderStart.empty']
    );
    expect(
      screen.queryByText(en['receptions.workOrderStart.emptyOnThisPage'])
    ).not.toBeInTheDocument();
    // Nothing further to look at, so the shared Pager renders nothing at all.
    expect(screen.queryByRole('button', { name: en['table.nextPage'] })).not.toBeInTheDocument();
  });

  it('offers the shared Pager, with no invented range, when a page is not the last', async () => {
    listCustomerVehicles.mockResolvedValue(
      page([OWN_VEHICLE], { hasMore: true, nextCursor: 'the-next-cursor' })
    );
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByRole('button', { name: en['table.nextPage'] })).toBeEnabled();
    expect(screen.getByRole('button', { name: en['table.previousPage'] })).toBeDisabled();
  });

  it('reports a failed read through the shared ListStates mapping, with its reference', async () => {
    listCustomerVehicles.mockResolvedValue(
      page([], { status: 'error', correlationId: 'step-correlation-id' })
    );
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByText(en['state.error.title'])).toBeVisible();
    expect(screen.getByText('step-correlation-id')).toBeVisible();
    expect(screen.getByRole('button', { name: en['state.retry'] })).toBeVisible();
  });

  it('reports a denial without pretending the list is empty', async () => {
    listCustomerVehicles.mockResolvedValue(
      page([], { status: 'denied', correlationId: 'step-denied-id' })
    );
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    expect(await screen.findByText(en['state.denied.title'])).toBeVisible();
    expect(screen.queryByTestId('work-order-start-empty')).not.toBeInTheDocument();
  });
});

describe('continuing from the customer profile into the existing check-in flow', () => {
  it('offers no way onward until exactly one vehicle is chosen', async () => {
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);
    await screen.findByRole('radio');

    const control = screen.getByTestId('work-order-start-continue');
    expect(control).toBeDisabled();
    // Disabled, not a link wearing a disabled look — a styled link is still
    // followable, and nothing may proceed without a vehicle.
    expect(control.tagName).not.toBe('A');
    expect(control).not.toHaveAttribute('href');
    expect(screen.getByText(en['receptions.workOrderStart.continueHint'])).toBeVisible();
  });

  it('links to the existing flow with both identifiers once a vehicle is chosen', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    await user.click(await screen.findByRole('radio'));

    const control = screen.getByTestId('work-order-start-continue');
    expect(control).toHaveAttribute(
      'href',
      checkInWizardHref('en', { customerId: CUSTOMER_ID, vehicleId: VEHICLE_ID })
    );
    expect(control.getAttribute('href')).toContain(CUSTOMER_ID);
    expect(control.getAttribute('href')).toContain(VEHICLE_ID);
    expect(control).toHaveTextContent(en['receptions.workOrderStart.continue']);
  });

  it('carries the locale into that link', async () => {
    const user = userEvent.setup();
    renderRtl(<CustomerWorkOrderStartScreen {...stepProps({ locale: 'ar', messages: ar })} />);

    await user.click(await screen.findByRole('radio'));

    expect(screen.getByTestId('work-order-start-continue')).toHaveAttribute(
      'href',
      checkInWizardHref('ar', { customerId: CUSTOMER_ID, vehicleId: VEHICLE_ID })
    );
    expect(screen.getByText(ar['receptions.workOrderStart.vehicleLegend'])).toBeVisible();
  });

  it('keeps exactly one vehicle chosen when a second is picked', async () => {
    const SECOND = {
      ...OWN_VEHICLE,
      id: '9c0d1e2f-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      vehicleId: SEARCHED_VEHICLE_ID,
      vehicleDisplayNumber: 'V-0009',
    };
    listCustomerVehicles.mockResolvedValue(page([OWN_VEHICLE, SECOND]));
    const user = userEvent.setup();
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    const choices = await screen.findAllByRole('radio');
    await user.click(choices[0] as HTMLElement);
    await user.click(choices[1] as HTMLElement);

    expect(
      screen.getAllByRole('radio').filter((input) => (input as HTMLInputElement).checked)
    ).toHaveLength(1);
    expect(screen.getByTestId('work-order-start-continue')).toHaveAttribute(
      'href',
      checkInWizardHref('en', { customerId: CUSTOMER_ID, vehicleId: SEARCHED_VEHICLE_ID })
    );
  });

  /** Open the find-or-add sub-flow from a step whose list came back empty. */
  async function addFromEmptyState(user: ReturnType<typeof userEvent.setup>) {
    listCustomerVehicles.mockResolvedValue(page([]));
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);
    await user.click(await screen.findByTestId('work-order-start-add'));
  }

  /** Record the relationship the sub-flow asks for, in the owner role. */
  async function recordTheRelationship(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByTestId('intake-link-step');
    await user.selectOptions(
      screen.getByLabelText(en['vehicles.relationships.role'], { exact: false }),
      'owner'
    );
    await user.click(screen.getByRole('button', { name: en['receptions.intake.link.submit'] }));
  }

  it('carries a vehicle registered from the empty state through to the check-in link', async () => {
    /*
     * The return path, end to end. A customer with nothing on record is the
     * case this step exists for, and every earlier case stopped at the moment
     * the sub-flow opened — so `settle` and `onLinkOutcome`, which are what
     * turn that sub-flow's answer into the pair handed to check-in, were
     * reachable only by reading the source.
     */
    const user = userEvent.setup();
    await addFromEmptyState(user);

    const create = await screen.findByTestId('intake-vehicle-create');
    await user.type(
      within(create).getByLabelText(en['vehicles.create.vin'], { exact: false }),
      '2hgcm82633a004999'
    );
    await user.click(within(create).getByRole('button', { name: en['vehicles.create.submit'] }));

    // A vehicle just registered is not yet related to the customer, so the
    // EXISTING relationship step runs before this step settles.
    await recordTheRelationship(user);
    expect(linkCustomerAction.mock.calls[0]?.[0]).toBe(CREATED_VEHICLE_ID);

    // Back on the customer's own step — the sub-flow is closed, not stacked.
    await screen.findByTestId('work-order-start-vehicle');
    expect(screen.queryByTestId('intake-vehicle-create')).not.toBeInTheDocument();

    const control = screen.getByTestId('work-order-start-continue');
    expect(control).toHaveAttribute(
      'href',
      checkInWizardHref('en', { customerId: CUSTOMER_ID, vehicleId: CREATED_VEHICLE_ID })
    );
    expect(control.getAttribute('href')).toContain(CUSTOMER_ID);
    expect(control.getAttribute('href')).toContain(CREATED_VEHICLE_ID);
  });

  it('carries a vehicle found by search and linked from the empty state to the same link', async () => {
    const user = userEvent.setup();
    await addFromEmptyState(user);

    const search = await screen.findByTestId('intake-vehicle-search');
    await user.type(within(search).getByLabelText(en['vehicles.search.vin']), SEARCH_HIT.vin);
    await user.click(within(search).getByRole('button', { name: en['vehicles.search.submit'] }));
    const results = await screen.findByTestId('intake-vehicle-search-results');
    await within(results).findByText('V-0100');
    await user.click(
      within(results).getByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    );

    await recordTheRelationship(user);
    expect(linkCustomerAction.mock.calls[0]?.[0]).toBe(SEARCHED_VEHICLE_ID);
    const form = linkCustomerAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('partnerId')).toBe(CUSTOMER_ID);

    await screen.findByTestId('work-order-start-vehicle');
    const control = screen.getByTestId('work-order-start-continue');
    expect(control).toHaveAttribute(
      'href',
      checkInWizardHref('en', { customerId: CUSTOMER_ID, vehicleId: SEARCHED_VEHICLE_ID })
    );
    expect(control.getAttribute('href')).toContain(CUSTOMER_ID);
    expect(control.getAttribute('href')).toContain(SEARCHED_VEHICLE_ID);
  });

  it('leaves the way onward closed while the sub-flow is still open', async () => {
    // The other direction of the same mechanism: a vehicle that has been
    // chosen but whose relationship question is unanswered has NOT settled,
    // and nothing may proceed on a half-finished answer.
    const user = userEvent.setup();
    await addFromEmptyState(user);

    const create = await screen.findByTestId('intake-vehicle-create');
    await user.type(
      within(create).getByLabelText(en['vehicles.create.vin'], { exact: false }),
      '2hgcm82633a004999'
    );
    await user.click(within(create).getByRole('button', { name: en['vehicles.create.submit'] }));
    await screen.findByTestId('intake-link-step');

    const control = screen.getByTestId('work-order-start-continue');
    expect(control).toBeDisabled();
    expect(control).not.toHaveAttribute('href');
  });

  it('creates nothing on its own — choosing a vehicle calls no write', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps()} />);

    await user.click(await screen.findByRole('radio'));

    expect(createVehicleAction).not.toHaveBeenCalled();
    expect(linkCustomerAction).not.toHaveBeenCalled();
  });

  /** The identity block beside Continue. */
  async function selectedIdentity(messages: typeof en = en) {
    const block = await screen.findByTestId('work-order-start-selected-vehicle');
    expect(block).toHaveTextContent(messages['receptions.workOrderStart.selectedVehicle']);
    return block;
  }

  /** Find the fixture vehicle by VIN in the sub-flow, choose it, and record the link. */
  async function searchAndLink(user: ReturnType<typeof userEvent.setup>) {
    const search = await screen.findByTestId('intake-vehicle-search');
    await user.type(within(search).getByLabelText(en['vehicles.search.vin']), SEARCH_HIT.vin);
    await user.click(within(search).getByRole('button', { name: en['vehicles.search.submit'] }));
    const results = await screen.findByTestId('intake-vehicle-search-results');
    await within(results).findByText('V-0100');
    await user.click(
      within(results).getByRole('button', { name: en['receptions.intake.vehicle.choose'] })
    );
    await recordTheRelationship(user);
  }

  it('names the registered vehicle beside Continue after the create return path', async () => {
    const user = userEvent.setup();
    await addFromEmptyState(user);

    const create = await screen.findByTestId('intake-vehicle-create');
    await user.type(
      within(create).getByLabelText(en['vehicles.create.vin'], { exact: false }),
      '2hgcm82633a004999'
    );
    await user.click(within(create).getByRole('button', { name: en['vehicles.create.submit'] }));
    await recordTheRelationship(user);

    const block = await selectedIdentity();
    expect(await within(block).findByTestId('work-order-start-selected-plate')).toHaveTextContent(
      '12-34567'
    );
    expect(within(block).queryByText('99-00001')).not.toBeInTheDocument();
    expect(within(block).getByTestId('work-order-start-selected-number')).toHaveTextContent(
      'V-0200'
    );
    expect(within(block).getByTestId('work-order-start-selected-vin')).toHaveTextContent(
      '2HGCM82633A004999'
    );
    expect(within(block).getByTestId('work-order-start-selected-model')).toHaveTextContent(
      'Honda Accord'
    );
    expect(readVehicleSummary).toHaveBeenCalledWith(CREATED_VEHICLE_ID);
    expect(listPlates.mock.calls[0]?.[0]).toBe(CREATED_VEHICLE_ID);
    // The identity and the link describe the same vehicle.
    expect(screen.getByTestId('work-order-start-continue').getAttribute('href')).toContain(
      CREATED_VEHICLE_ID
    );
  });

  it('names the searched and linked vehicle beside Continue after the link return path', async () => {
    const user = userEvent.setup();
    await addFromEmptyState(user);
    await searchAndLink(user);

    const block = await selectedIdentity();
    expect(await within(block).findByTestId('work-order-start-selected-plate')).toHaveTextContent(
      '12-34567'
    );
    expect(within(block).getByTestId('work-order-start-selected-number')).toHaveTextContent(
      'V-0100'
    );
    expect(within(block).getByTestId('work-order-start-selected-vin')).toHaveTextContent(
      SEARCH_HIT.vin
    );
    const model = within(block).getByTestId('work-order-start-selected-model');
    expect(within(model).getByText('Honda Accord')).toBeInTheDocument();
    expect(within(model).getByText('2021')).toBeInTheDocument();
    expect(readVehicleSummary).toHaveBeenCalledWith(SEARCHED_VEHICLE_ID);
  });

  it('falls back to a neutral label and the vehicle number when the vehicle read is refused', async () => {
    readVehicleSummary.mockResolvedValue({ status: 'denied', correlationId: 'refused-ref' });
    listPlates.mockResolvedValue(page([], { status: 'denied' }));
    const user = userEvent.setup();
    await addFromEmptyState(user);
    await searchAndLink(user);

    const block = await selectedIdentity();
    await vi.waitFor(() => expect(readVehicleSummary).toHaveBeenCalledWith(SEARCHED_VEHICLE_ID));
    await vi.waitFor(() => expect(listPlates).toHaveBeenCalled());
    expect(within(block).getByTestId('work-order-start-selected-number')).toHaveTextContent(
      'V-0100'
    );
    expect(within(block).queryByTestId('work-order-start-selected-plate')).not.toBeInTheDocument();
    expect(within(block).queryByTestId('work-order-start-selected-vin')).not.toBeInTheDocument();
    expect(within(block).queryByTestId('work-order-start-selected-model')).not.toBeInTheDocument();
  });

  it('does not read the vehicle for an operator without vehicle read access, and stays neutral', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerWorkOrderStartScreen {...stepProps({ canSearchVehicles: false })} />);

    await user.click(await screen.findByRole('radio'));

    const block = await selectedIdentity();
    expect(within(block).getByTestId('work-order-start-selected-number')).toHaveTextContent(
      'V-0007'
    );
    expect(within(block).queryByTestId('work-order-start-selected-vin')).not.toBeInTheDocument();
    expect(readVehicleSummary).not.toHaveBeenCalled();
    expect(listPlates).not.toHaveBeenCalled();
  });

  it('names the selected vehicle in Arabic too', async () => {
    const user = userEvent.setup();
    renderRtl(<CustomerWorkOrderStartScreen {...stepProps({ locale: 'ar', messages: ar })} />);

    await user.click(await screen.findByRole('radio'));

    const block = await selectedIdentity(ar);
    expect(await within(block).findByTestId('work-order-start-selected-plate')).toHaveTextContent(
      '12-34567'
    );
    expect(block).toHaveTextContent(ar['vehicles.column.plate']);
    expect(block).toHaveTextContent(ar['vehicles.column.vin']);
    expect(within(block).getByTestId('work-order-start-selected-number')).toHaveTextContent(
      'V-0007'
    );
  });
});
