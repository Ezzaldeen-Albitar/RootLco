import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * A vehicle can be sold, and somebody can be authorised to collect it
 * (`P1-27-FE-021`, `P1-27-FE-025`, defect D1).
 *
 * Three operations shipped registered, permission-covered, audit-classed and
 * reachable from no screen for the whole of P1-27:
 *
 *   - `veh.vehicle-ownership-transfer` — a vehicle could not change owner.
 *   - `veh.vehicle-authorized-party-add` — nobody could be authorised.
 *   - `veh.vehicle-authorized-party-retire` — nor un-authorised.
 *
 * All three want a `partnerId`, which is why they stayed unwired: the only
 * control derivable from the contract alone is a uuid text box, and no workshop
 * employee knows a uuid. These tests assert the write is REACHABLE and that the
 * chooser is a name.
 *
 * The actions are mocked at the module boundary — a component test cannot call
 * a `'use server'` module, and what is under test is the screen's decision about
 * when to offer the write and what to send, not the request itself.
 */

const listOwnerships = vi.fn();
const listRelationships = vi.fn();
const transferOwnershipAction = vi.fn();
const authorizePartyAction = vi.fn();
const retirePartyAction = vi.fn();
const linkCustomerAction = vi.fn();
const searchCustomerDirectory = vi.fn();

vi.mock('@/features/vehicles/history-api', () => ({
  listOwnerships: (...a: unknown[]) => listOwnerships(...a),
  listPlates: vi.fn(async () => EMPTY),
  listOdometerReadings: vi.fn(async () => EMPTY),
  assignPlateAction: vi.fn(),
  recordOdometerAction: vi.fn(),
  transferOwnershipAction: (...a: unknown[]) => transferOwnershipAction(...a),
}));
vi.mock('@/features/vehicles/relations-api', () => ({
  listRelationships: (...a: unknown[]) => listRelationships(...a),
  setEvProfileAction: vi.fn(),
  authorizePartyAction: (...a: unknown[]) => authorizePartyAction(...a),
  retirePartyAction: (...a: unknown[]) => retirePartyAction(...a),
  linkCustomerAction: (...a: unknown[]) => linkCustomerAction(...a),
}));
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...a: unknown[]) => searchCustomerDirectory(...a),
}));

const { OwnershipSection } = await import('@/features/vehicles/components/VehicleHistorySections');
const { RelationshipsSection } =
  await import('@/features/vehicles/components/VehicleRelationsSections');

const CUSTOMER_UUID = '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479';

const EMPTY = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

/**
 * The customer the selector finds — deliberately NOT the one already on the
 * vehicle.
 *
 * They were the same person on the first draft, and six tests failed with
 * "Found multiple elements with the text: Layla Haddad" because the existing
 * ownership row and the search result carried one name. A transfer to a
 * different customer is also the realistic case.
 */
const CUSTOMER = {
  id: CUSTOMER_UUID,
  displayNumber: 'C-000501',
  displayName: 'Nadia Kanaan',
  partyType: 'individual',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function page(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return { ...EMPTY, rows, ...overrides };
}

const NAMED = {
  partnerName: 'Layla Haddad',
  partnerNumber: 'C-000482',
  partnerType: 'individual',
};

function ownership(over: Record<string, unknown> = {}) {
  return {
    id: 'own-1',
    partnerId: CUSTOMER_UUID,
    ...NAMED,
    ownershipKind: 'registered_owner',
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function relationship(over: Record<string, unknown> = {}) {
  return {
    id: 'rel-1',
    partnerId: CUSTOMER_UUID,
    ...NAMED,
    relationshipRole: 'authorized_person',
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
    allowedActions: ['receive_vehicle'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const ownerships = (canManageRelationships = true) =>
  renderLtr(
    <OwnershipSection
      locale="en"
      messages={en}
      vehicleId="v1"
      today="2026-08-08"
      canManageRelationships={canManageRelationships}
    />
  );

const relationships = (canManage = true) =>
  renderLtr(
    <RelationshipsSection
      locale="en"
      messages={en}
      vehicleId="v1"
      today="2026-08-08"
      canManage={canManage}
    />
  );

/**
 * The role select, matched loosely on purpose.
 *
 * `RecordForm` renders a decorative `*` inside the `<label>` of a required
 * field, so the accessible name is "Role*" and an exact `getByLabelText('Role')`
 * finds nothing. Matching the prefix keeps the assertion about the control
 * rather than about the asterisk.
 */
const roleSelect = () => screen.getByLabelText(en['vehicles.relationships.role'], { exact: false });

/** Search, then click the one match. Shared by both write suites. */
async function chooseCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Nadia');
  await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
  await screen.findByText('Nadia Kanaan');
  await user.click(screen.getByRole('button', { name: /Nadia Kanaan/ }));
  await screen.findByRole('button', { name: en['customerSelector.change'] });
}

beforeEach(() => {
  listOwnerships.mockReset();
  listRelationships.mockReset();
  transferOwnershipAction.mockReset();
  authorizePartyAction.mockReset();
  retirePartyAction.mockReset();
  linkCustomerAction.mockReset();
  searchCustomerDirectory.mockReset();

  listOwnerships.mockResolvedValue(page([ownership()]));
  listRelationships.mockResolvedValue(page([relationship()]));
  searchCustomerDirectory.mockResolvedValue(page([CUSTOMER]));
  transferOwnershipAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.ownership.transferred',
  });
  authorizePartyAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.relationships.authorized',
  });
  retirePartyAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.relationships.retired',
  });
  linkCustomerAction.mockResolvedValue({
    status: 'success',
    messageKey: 'vehicles.relationships.linked',
  });
});

describe('FE-021 — ownership transfer is reachable', () => {
  it('offers the transfer form to an operator who may manage relationships', async () => {
    ownerships(true);
    expect(
      await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] })
    ).toBeInTheDocument();
  });

  it('offers it to nobody else', async () => {
    ownerships(false);
    await screen.findByText('Layla Haddad');
    // `veh.vehicle.relationship.manage`, deliberately not `veh.vehicle.manage`:
    // who a vehicle belongs to is not governed by who may edit its colour.
    expect(
      screen.queryByRole('button', { name: en['vehicles.ownership.transfer'] })
    ).not.toBeInTheDocument();
  });

  it('sends the transfer once a customer is chosen by name', async () => {
    const user = userEvent.setup();
    ownerships(true);
    await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] });
    await chooseCustomer(user);
    await user.click(screen.getByRole('button', { name: en['vehicles.ownership.transfer'] }));

    await waitFor(() => expect(transferOwnershipAction).toHaveBeenCalledTimes(1));
    // The uuid the SELECTOR produced — submitted, never typed.
    // Index 2, not 1: the screen binds the vehicle id, so the mock sees
    // `(vehicleId, previousState, formData)`.
    const form = transferOwnershipAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('partnerId')).toBe(CUSTOMER_UUID);
  });

  it('refuses to send with no customer chosen, and spends no request', async () => {
    const user = userEvent.setup();
    ownerships(true);
    await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] });
    await user.click(screen.getByRole('button', { name: en['vehicles.ownership.transfer'] }));

    expect(await screen.findByText(en['vehicles.ownership.error.customer'])).toBeInTheDocument();
    // The guard runs BEFORE the action, so an incomplete form costs no
    // rate-limit slot and the operator is told instantly.
    expect(transferOwnershipAction).not.toHaveBeenCalled();
  });

  it('offers no free-text field for an identifier anywhere', async () => {
    const { container } = ownerships(true);
    await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] });
    for (const input of container.querySelectorAll('input')) {
      // A visible box named `partnerId` would be the defect this fix exists to
      // remove. The only one carrying that name is the selector's hidden input.
      if (input.getAttribute('name') === 'partnerId') {
        expect(input.getAttribute('type')).toBe('hidden');
      }
    }
  });

  it('sends the chosen day exactly, with no timezone round-trip', async () => {
    const user = userEvent.setup();
    ownerships(true);
    await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] });
    await chooseCustomer(user);

    const date = screen.getByLabelText(en['vehicles.interval.from']);
    await user.type(date, '2026-03-01');
    await user.click(screen.getByRole('button', { name: en['vehicles.ownership.transfer'] }));

    await waitFor(() => expect(transferOwnershipAction).toHaveBeenCalled());
    // Index 2, not 1: the screen binds the vehicle id, so the mock sees
    // `(vehicleId, previousState, formData)`.
    const form = transferOwnershipAction.mock.calls[0]?.[2] as FormData;
    // `2026-03-01`, not `2026-02-28T22:00:00.000Z` sliced back to a day.
    expect(form.get('effectiveDate')).toBe('2026-03-01');
  });

  it('keeps the chosen customer when the write fails', async () => {
    const user = userEvent.setup();
    transferOwnershipAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.formError',
      correlationId: 'corr-quotable',
    });
    ownerships(true);
    await screen.findByRole('button', { name: en['vehicles.ownership.transfer'] });
    await chooseCustomer(user);
    await user.click(screen.getByRole('button', { name: en['vehicles.ownership.transfer'] }));

    await waitFor(() => expect(transferOwnershipAction).toHaveBeenCalled());
    /*
     * The correlation reference is awaited, because being CALLED is not being
     * RENDERED.
     *
     * The `waitFor` above resolves when the action has been invoked; the conflict
     * state it returns reaches the DOM one React update later. A synchronous
     * `getByText` therefore raced that update and intermittently read the screen
     * before it carried the reference. Same latent defect as
     * `crm-customer-create.dom.test.tsx`, exposed the same way.
     */
    expect(await screen.findByText('corr-quotable')).toBeInTheDocument();
    // Re-choosing a customer after a conflict that was not the operator's fault
    // is exactly the retyping `RecordForm` exists to prevent.
    expect(screen.getByRole('button', { name: en['customerSelector.change'] })).toBeInTheDocument();
  });
});

describe('FE-025 — authorising a party is reachable', () => {
  it('offers the form to an operator who may manage relationships', async () => {
    relationships(true);
    expect(
      await screen.findByRole('button', { name: en['vehicles.relationships.authorize'] })
    ).toBeInTheDocument();
  });

  it('offers it to nobody else', async () => {
    relationships(false);
    await screen.findByText('Layla Haddad');
    expect(
      screen.queryByRole('button', { name: en['vehicles.relationships.authorize'] })
    ).not.toBeInTheDocument();
  });

  it('sends the customer and the chosen scope', async () => {
    const user = userEvent.setup();
    relationships(true);
    await screen.findByRole('button', { name: en['vehicles.relationships.authorize'] });
    await chooseCustomer(user);
    await user.click(screen.getByLabelText(en['vehicles.action.receive_vehicle']));
    await user.click(screen.getByRole('button', { name: en['vehicles.relationships.authorize'] }));

    await waitFor(() => expect(authorizePartyAction).toHaveBeenCalledTimes(1));
    const form = authorizePartyAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('partnerId')).toBe(CUSTOMER_UUID);
    expect(form.getAll('allowedActions')).toEqual(['receive_vehicle']);
  });

  it('refuses an empty scope, which the constraint forbids anyway', async () => {
    const user = userEvent.setup();
    relationships(true);
    await screen.findByRole('button', { name: en['vehicles.relationships.authorize'] });
    await chooseCustomer(user);
    await user.click(screen.getByRole('button', { name: en['vehicles.relationships.authorize'] }));

    expect(await screen.findByText(en['vehicles.relationships.scopeEmpty'])).toBeInTheDocument();
    expect(authorizePartyAction).not.toHaveBeenCalled();
  });

  it('offers exactly the six approved actions and no seventh', async () => {
    relationships(true);
    await screen.findByRole('button', { name: en['vehicles.relationships.authorize'] });
    for (const action of [
      'approve_quotation',
      'approve_additional_work',
      'receive_vehicle',
      'receive_reports',
      'receive_invoices',
      'communicate_about_service',
    ]) {
      expect(
        screen.getByLabelText(en[`vehicles.action.${action}` as keyof typeof en])
      ).toBeInTheDocument();
    }
    // Nothing here grants ownership or any escalated authority.
    for (const label of screen.getAllByRole('checkbox')) {
      expect(label.getAttribute('value')).not.toMatch(/owner|transfer|delete|merge/i);
    }
  });
});

describe('FE-025 — linking a customer is reachable', () => {
  it('offers the link form on its OWN capability, not the vehicle one', async () => {
    // `crm.vehicle-link` needs `crm.customer.vehicle.manage` — a different
    // module and a different code from `veh.vehicle.relationship.manage`. An
    // operator may hold either without the other.
    renderLtr(
      <RelationshipsSection
        locale="en"
        messages={en}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
        canLinkCustomer
      />
    );
    expect(
      await screen.findByRole('button', { name: en['vehicles.relationships.link'] })
    ).toBeInTheDocument();
    // …and the OTHER write stays hidden, proving the two gates are independent.
    expect(
      screen.queryByRole('button', { name: en['vehicles.relationships.authorize'] })
    ).not.toBeInTheDocument();
  });

  it('offers it to nobody without that capability', async () => {
    relationships(true);
    await screen.findByText('Layla Haddad');
    expect(
      screen.queryByRole('button', { name: en['vehicles.relationships.link'] })
    ).not.toBeInTheDocument();
  });

  it('sends the chosen customer and role', async () => {
    const user = userEvent.setup();
    renderLtr(
      <RelationshipsSection
        locale="en"
        messages={en}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
        canLinkCustomer
      />
    );
    await screen.findByRole('button', { name: en['vehicles.relationships.link'] });
    await chooseCustomer(user);
    await user.selectOptions(roleSelect(), 'driver');
    await user.click(screen.getByRole('button', { name: en['vehicles.relationships.link'] }));

    await waitFor(() => expect(linkCustomerAction).toHaveBeenCalledTimes(1));
    const form = linkCustomerAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('partnerId')).toBe(CUSTOMER_UUID);
    expect(form.get('relationshipRole')).toBe('driver');
  });

  it('offers six roles and NOT authorised person', async () => {
    renderLtr(
      <RelationshipsSection
        locale="en"
        messages={en}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
        canLinkCustomer
      />
    );
    await screen.findByRole('button', { name: en['vehicles.relationships.link'] });
    const select = roleSelect();
    const values = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v) => v !== '');

    expect(values).toHaveLength(6);
    // `ck_vehicle_relationships_scope_role` makes `authorized_person` the only
    // role that may carry a scope, and this operation sets none — so linking in
    // that role would create a row the screen itself calls unexpected data.
    expect(values).not.toContain('authorized_person');
  });

  it('refuses to send with no customer chosen', async () => {
    const user = userEvent.setup();
    renderLtr(
      <RelationshipsSection
        locale="en"
        messages={en}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
        canLinkCustomer
      />
    );
    await screen.findByRole('button', { name: en['vehicles.relationships.link'] });
    await user.selectOptions(roleSelect(), 'driver');
    await user.click(screen.getByRole('button', { name: en['vehicles.relationships.link'] }));

    expect(await screen.findByText(en['vehicles.ownership.error.customer'])).toBeInTheDocument();
    expect(linkCustomerAction).not.toHaveBeenCalled();
  });
});

describe('FE-025 — retiring a party is reachable, and only where it can work', () => {
  it('offers the control on an open authorised party', async () => {
    relationships(true);
    expect(
      await screen.findByRole('button', { name: en['vehicles.relationships.retire'] })
    ).toBeInTheDocument();
  });

  it('offers it on no other role', async () => {
    // The operation closes an open `authorized_person` interval. On an owner row
    // the control could only fail — and would suggest ownership can be ended
    // from here, which it cannot.
    listRelationships.mockResolvedValue(page([relationship({ relationshipRole: 'owner' })]));
    relationships(true);
    await screen.findByText('Layla Haddad');
    expect(
      screen.queryByRole('button', { name: en['vehicles.relationships.retire'] })
    ).not.toBeInTheDocument();
  });

  it('offers it on no already-closed authorisation', async () => {
    listRelationships.mockResolvedValue(
      page([relationship({ validTo: '2026-06-01', active: false })])
    );
    relationships(true);
    await screen.findByText('Layla Haddad');
    expect(
      screen.queryByRole('button', { name: en['vehicles.relationships.retire'] })
    ).not.toBeInTheDocument();
  });

  it('confirms before ending an authorisation', async () => {
    const user = userEvent.setup();
    relationships(true);
    await user.click(
      await screen.findByRole('button', { name: en['vehicles.relationships.retire'] })
    );
    // A mis-click in a table row would otherwise end somebody's authority to
    // collect a vehicle.
    expect(screen.getByText(en['vehicles.relationships.retireConfirm'])).toBeInTheDocument();
    expect(retirePartyAction).not.toHaveBeenCalled();
  });

  it('sends the retirement once confirmed', async () => {
    const user = userEvent.setup();
    relationships(true);
    await user.click(
      await screen.findByRole('button', { name: en['vehicles.relationships.retire'] })
    );
    const panel = screen.getByText(en['vehicles.relationships.retireConfirm']).parentElement;
    await user.click(
      within(panel as HTMLElement).getByRole('button', {
        name: en['vehicles.relationships.retire'],
      })
    );
    await waitFor(() => expect(retirePartyAction).toHaveBeenCalledTimes(1));
  });

  it('can be abandoned', async () => {
    const user = userEvent.setup();
    relationships(true);
    await user.click(
      await screen.findByRole('button', { name: en['vehicles.relationships.retire'] })
    );
    await user.click(screen.getByRole('button', { name: en['admin.cancel'] }));
    expect(screen.queryByText(en['vehicles.relationships.retireConfirm'])).not.toBeInTheDocument();
    expect(retirePartyAction).not.toHaveBeenCalled();
  });
});

describe('a denial is the backend’s to make', () => {
  it('shows a denial from the write rather than pretending it succeeded', async () => {
    const user = userEvent.setup();
    authorizePartyAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'form.formError',
      correlationId: 'corr-denied',
    });
    relationships(true);
    await screen.findByRole('button', { name: en['vehicles.relationships.authorize'] });
    await chooseCustomer(user);
    await user.click(screen.getByLabelText(en['vehicles.action.receive_vehicle']));
    await user.click(screen.getByRole('button', { name: en['vehicles.relationships.authorize'] }));

    // The client-side `canManage` gate hides the control; it is not the
    // decision. The backend refused and the screen says so, with a reference.
    expect(await screen.findByText('corr-denied')).toBeInTheDocument();
  });
});

describe('the same writes in Arabic', () => {
  it('offers the transfer in Arabic and RTL', async () => {
    renderRtl(
      <OwnershipSection
        locale="ar"
        messages={ar}
        vehicleId="v1"
        today="2026-08-08"
        canManageRelationships
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      await screen.findByRole('button', { name: ar['vehicles.ownership.transfer'] })
    ).toBeInTheDocument();
  });

  it('offers the authorisation in Arabic and RTL', async () => {
    renderRtl(
      <RelationshipsSection locale="ar" messages={ar} vehicleId="v1" today="2026-08-08" canManage />
    );
    expect(
      await screen.findByRole('button', { name: ar['vehicles.relationships.authorize'] })
    ).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('asserts against catalogue entries that really exist', () => {
    for (const key of [
      'vehicles.ownership.transfer',
      'vehicles.ownership.error.customer',
      'vehicles.relationships.authorize',
      'vehicles.relationships.retire',
      'vehicles.relationships.retireConfirm',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });
});
